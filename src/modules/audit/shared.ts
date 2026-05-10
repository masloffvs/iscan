import { load } from "cheerio";
import type { Browser, BrowserContext, Page } from "playwright-core";

import { $axios } from "../../axios";
import { CloakKit } from "../../kits";
import { InvalidParamsError } from "../errors";
import { defineNotebookTypeOverlay, type ModuleConsoleParam, type ModuleExecutionContext } from "../module";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_ASSETS = 12;
const DEFAULT_MAX_ASSET_KB = 1024;
const DEFAULT_BROWSER_RENDER_MS = 1000;
const DEFAULT_MAX_PATTERN_MATCHES = 5;
export const AUDIT_NOTEBOOK_TYPE_OVERLAY = defineNotebookTypeOverlay("src/modules/audit/audit.h.ts");

export type AuditFetchMode = "http" | "browser";

export type AuditSeverity = "high" | "medium" | "low";

export type AuditSecretDetector = {
	kind: string;
	severity: AuditSeverity;
	message: string;
	regex: RegExp;
};

export type AuditSecretDetection = {
	kind: string;
	severity: AuditSeverity;
	message: string;
	value: string;
};

export type AuditFindingLike = {
	severity: AuditSeverity;
	kind: string;
	location: string;
	evidence: string;
	rawEvidence?: string;
	message: string;
};

export type AuditTraversalInputParams = {
	url?: string;
	timeoutMs?: number;
	maxAssets?: number;
	maxAssetKb?: number;
	sameOriginOnly?: boolean;
	fetchMode?: AuditFetchMode;
	cloakProfileId?: string;
	renderMs?: number;
};

export type AuditAssetDescriptor = {
	kind: "script" | "style" | "modulepreload";
	url: string;
};

export type AuditTextResource = {
	url: string;
	content: string;
	status: number;
	contentType?: string;
	bytes: number;
};

export type ResolvedAuditTraversalParams = {
	entryUrl: URL;
	timeoutMs: number;
	maxAssets: number;
	maxAssetBytes: number;
	sameOriginOnly: boolean;
	fetchMode: AuditFetchMode;
	cloakProfileId?: string;
	renderMs: number;
};

export type AuditTraversalResult = {
	document: AuditTextResource;
	assets: AuditAssetDescriptor[];
	inlineScripts: string[];
	assetsDiscovered: number;
	assetsSkipped: number;
};

export const AUDIT_TRAVERSAL_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "url",
		detail: "Absolute entry URL to audit.",
		valueType: "string",
		example: "url=https://app.example.com",
		required: true,
	},
	{
		name: "timeoutMs",
		detail: "HTTP or browser request timeout in milliseconds.",
		valueType: "number",
		example: "timeoutMs=15000",
	},
	{
		name: "maxAssets",
		detail: "Maximum same-origin assets to scan after entry traversal.",
		valueType: "number",
		example: "maxAssets=20",
	},
	{
		name: "maxAssetKb",
		detail: "Maximum size per downloaded asset in kilobytes.",
		valueType: "number",
		example: "maxAssetKb=1024",
	},
	{
		name: "sameOriginOnly",
		detail: "Restrict discovered asset scanning to the entry origin.",
		valueType: "boolean",
		values: ["true", "false"],
		example: "sameOriginOnly=true",
	},
	{
		name: "fetchMode",
		detail: "Use raw HTTP or browser-backed rendering.",
		valueType: "string",
		values: ["http", "browser"],
		example: "fetchMode=browser",
	},
	{
		name: "cloakProfileId",
		detail: "Cloak profile id/name used when fetchMode=browser.",
		valueType: "string",
		example: "cloakProfileId=cf",
	},
	{
		name: "renderMs",
		detail: "Extra browser render wait time in milliseconds before DOM snapshot.",
		valueType: "number",
		example: "renderMs=1500",
	},
];

type AuditTraversalContext = Pick<ModuleExecutionContext<unknown, object>, "runtime" | "getCloakKit" | "logger">;

type BrowserPageLease = {
	page: Page;
	close(): Promise<void>;
};

function readRequiredUrl(value: unknown): URL {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new InvalidParamsError("Param 'url' is required. Example: url=https://app.example.com");
	}

	const normalized = value.trim();
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		throw new InvalidParamsError(`Param 'url' must be an absolute URL. Received: ${normalized}`);
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new InvalidParamsError("Param 'url' must use http or https.");
	}

	return parsed;
}

function readOptionalPositiveInteger(value: unknown, paramName: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new InvalidParamsError(`Param '${paramName}' must be a positive integer.`);
	}

	return value;
}

function readOptionalNonNegativeInteger(value: unknown, paramName: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new InvalidParamsError(`Param '${paramName}' must be a non-negative integer.`);
	}

	return value;
}

function readOptionalBoolean(value: unknown, paramName: string): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "boolean") {
		throw new InvalidParamsError(`Param '${paramName}' must be a boolean.`);
	}

	return value;
}

function readOptionalString(value: unknown, paramName: string): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "string" || value.trim().length === 0) {
		throw new InvalidParamsError(`Param '${paramName}' must be a non-empty string.`);
	}

	return value.trim();
}

function readFetchMode(value: unknown): AuditFetchMode | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (value !== "http" && value !== "browser") {
		throw new InvalidParamsError("Param 'fetchMode' must be either 'http' or 'browser'.");
	}

	return value;
}

export function resolveAuditTraversalParams(
	params: AuditTraversalInputParams,
): ResolvedAuditTraversalParams {
	const fetchMode = readFetchMode(params.fetchMode) ?? "http";
	const cloakProfileId = readOptionalString(params.cloakProfileId, "cloakProfileId");
	const renderMs = readOptionalNonNegativeInteger(params.renderMs, "renderMs")
		?? (fetchMode === "browser" ? DEFAULT_BROWSER_RENDER_MS : 0);

	if (fetchMode === "browser" && !cloakProfileId) {
		throw new InvalidParamsError("Param 'cloakProfileId' is required when fetchMode='browser'.");
	}

	return {
		entryUrl: readRequiredUrl(params.url),
		timeoutMs: readOptionalPositiveInteger(params.timeoutMs, "timeoutMs") ?? DEFAULT_TIMEOUT_MS,
		maxAssets: readOptionalPositiveInteger(params.maxAssets, "maxAssets") ?? DEFAULT_MAX_ASSETS,
		maxAssetBytes: (readOptionalPositiveInteger(params.maxAssetKb, "maxAssetKb") ?? DEFAULT_MAX_ASSET_KB) * 1024,
		sameOriginOnly: readOptionalBoolean(params.sameOriginOnly, "sameOriginOnly") ?? true,
		fetchMode,
		cloakProfileId,
		renderMs,
	};
}

export async function fetchTextResource(
	url: string,
	timeoutMs: number,
	maxBytes: number,
): Promise<AuditTextResource> {
	const response = await $axios.get<string>(url, {
		responseType: "text",
		timeout: timeoutMs,
		maxContentLength: maxBytes,
		transitional: {
			forcedJSONParsing: false,
		},
	});

	const content = typeof response.data === "string"
		? response.data
		: JSON.stringify(response.data);

	return {
		url,
		content,
		status: response.status,
		contentType: typeof response.headers["content-type"] === "string"
			? response.headers["content-type"]
			: undefined,
		bytes: Buffer.byteLength(content, "utf8"),
	};
}

export function collectAuditPatternMatches(
	regex: RegExp,
	content: string,
	maxMatches = DEFAULT_MAX_PATTERN_MATCHES,
): string[] {
	const pattern = new RegExp(regex.source, regex.flags);
	const matches: string[] = [];
	for (const match of content.matchAll(pattern)) {
		const value = match[0]?.trim();
		if (!value) {
			continue;
		}

		matches.push(value);
		if (matches.length >= maxMatches) {
			break;
		}
	}

	return matches;
}

export function maskAuditSecret(value: string): string {
	if (value.length <= 8) {
		return "********";
	}

	return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function collectAuditSecretDetections(
	content: string,
	detectors: readonly AuditSecretDetector[],
	maxMatchesPerDetector = DEFAULT_MAX_PATTERN_MATCHES,
): AuditSecretDetection[] {
	const detections: AuditSecretDetection[] = [];

	for (const detector of detectors) {
		for (const value of collectAuditPatternMatches(detector.regex, content, maxMatchesPerDetector)) {
			detections.push({
				kind: detector.kind,
				severity: detector.severity,
				message: detector.message,
				value,
			});
		}
	}

	return detections;
}

export function pushAuditFinding<Finding extends AuditFindingLike>(
	findings: Finding[],
	seenFindings: Set<string>,
	finding: Finding,
): void {
	const key = [
		finding.severity,
		finding.kind,
		finding.location,
		finding.evidence,
		finding.rawEvidence ?? "",
		finding.message,
	].join("\u0000");

	if (seenFindings.has(key)) {
		return;
	}

	seenFindings.add(key);
	findings.push(finding);
}

export function sortAuditFindings<Finding extends AuditFindingLike>(
	findings: readonly Finding[],
): Finding[] {
	const severityWeight: Record<AuditSeverity, number> = {
		high: 0,
		medium: 1,
		low: 2,
	};

	return [...findings].sort((left, right) => {
		const severityOrder = severityWeight[left.severity] - severityWeight[right.severity];
		if (severityOrder !== 0) {
			return severityOrder;
		}

		const kindOrder = left.kind.localeCompare(right.kind);
		if (kindOrder !== 0) {
			return kindOrder;
		}

		return left.location.localeCompare(right.location);
	});
}

function collectAssets(
	html: string,
	entryUrl: URL,
	sameOriginOnly: boolean,
): { assets: AuditAssetDescriptor[]; discovered: number; skipped: number; inlineScripts: string[] } {
	const $ = load(html);
	const assets: AuditAssetDescriptor[] = [];
	const seenUrls = new Set<string>();
	let discovered = 0;
	let skipped = 0;

	const pushAsset = (kind: AuditAssetDescriptor["kind"], rawValue: string | undefined) => {
		if (!rawValue) {
			return;
		}

		let resolved: URL;
		try {
			resolved = new URL(rawValue, entryUrl);
		} catch {
			skipped += 1;
			return;
		}

		discovered += 1;
		if (sameOriginOnly && resolved.origin !== entryUrl.origin) {
			skipped += 1;
			return;
		}

		if (seenUrls.has(resolved.href)) {
			return;
		}

		seenUrls.add(resolved.href);
		assets.push({ kind, url: resolved.href });
	};

	$("script[src]").each((_, element) => {
		pushAsset("script", $(element).attr("src"));
	});

	$("link[href][rel='modulepreload']").each((_, element) => {
		pushAsset("modulepreload", $(element).attr("href"));
	});

	$("link[href][rel='stylesheet']").each((_, element) => {
		pushAsset("style", $(element).attr("href"));
	});

	const inlineScripts = $("script:not([src])")
		.toArray()
		.map((element) => $(element).html()?.trim() ?? "")
		.filter(Boolean);

	return { assets, discovered, skipped, inlineScripts };
}

function isBrowser(session: Browser | BrowserContext): session is Browser {
	return typeof (session as Browser).newContext === "function";
}

async function ensureCloakKit(context: AuditTraversalContext, reason: string): Promise<CloakKit> {
	let kit = context.getCloakKit();
	if (kit) {
		return kit;
	}

	kit = await context.runtime.attachKit(new CloakKit(), {
		reason,
	});
	return kit;
}

async function openCloakPage(
	context: AuditTraversalContext,
	profileId: string,
	reason: string,
): Promise<BrowserPageLease> {
	const kit = await ensureCloakKit(context, reason);
	const launchedSession = await kit.launchProfile(profileId, {
		headless: true,
		freshSession: true,
		trackSession: false,
	});
	if (isBrowser(launchedSession)) {
		const browserContext = await launchedSession.newContext();
		const page = await browserContext.newPage();
		return {
			page,
			close: async () => {
				await launchedSession.close();
			},
		};
	}

	const page = await launchedSession.newPage();
	return {
		page,
		close: async () => {
			await launchedSession.close();
		},
	};
}

async function fetchDocumentWithBrowser(
	context: AuditTraversalContext,
	params: ResolvedAuditTraversalParams,
	reason: string,
): Promise<AuditTextResource> {
	const lease = await openCloakPage(context, params.cloakProfileId!, reason);
	try {
		const response = await lease.page.goto(params.entryUrl.href, {
			waitUntil: "domcontentloaded",
			timeout: params.timeoutMs,
		});

		await lease.page.waitForLoadState("networkidle", {
			timeout: Math.min(params.timeoutMs, 5000),
		}).catch(() => {});

		if (params.renderMs > 0) {
			await lease.page.waitForTimeout(params.renderMs);
		}

		const content = await lease.page.content();
		return {
			url: lease.page.url(),
			content,
			status: response?.status() ?? 200,
			contentType: response?.headers()["content-type"],
			bytes: Buffer.byteLength(content, "utf8"),
		};
	} finally {
		await lease.close().catch(() => {});
	}
}

export async function traverseAuditDocument(
	context: AuditTraversalContext,
	params: ResolvedAuditTraversalParams,
	options: { reason?: string } = {},
): Promise<AuditTraversalResult> {
	const document = params.fetchMode === "browser"
		? await fetchDocumentWithBrowser(
			context,
			params,
			options.reason ?? "audit browser traversal",
		)
		: await fetchTextResource(params.entryUrl.href, params.timeoutMs, params.maxAssetBytes);

	const collected = collectAssets(
		document.content,
		new URL(document.url),
		params.sameOriginOnly,
	);
	const assets = collected.assets.slice(0, params.maxAssets);
	const skippedByLimit = Math.max(collected.assets.length - assets.length, 0);

	return {
		document,
		assets,
		inlineScripts: collected.inlineScripts,
		assetsDiscovered: collected.discovered,
		assetsSkipped: collected.skipped + skippedByLimit,
	};
}