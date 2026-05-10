import { load } from "cheerio";
import type { Browser, BrowserContext, Page, Request as PlaywrightRequest, Response as PlaywrightResponse } from "playwright-core";

import { $axios } from "../../axios";
import { $storageKit, CloakKit, type StorageKit } from "../../kits";
import { InvalidParamsError } from "../errors";
import {
	collectAuditPatternMatches,
	collectAuditSecretDetections,
	fetchTextResource,
	maskAuditSecret,
	pushAuditFinding,
	resolveAuditTraversalParams,
	sortAuditFindings,
	type AuditSeverity,
	type AuditTraversalInputParams,
	type ResolvedAuditTraversalParams,
} from "./shared";
import { AUDIT_SECRET_DETECTORS } from "./datasets";

const MAX_MATCHES_PER_PATTERN = 5;

export type AuditCrawlParams = AuditTraversalInputParams;

export type AuditCrawlSeverity = AuditSeverity;

export type AuditCrawlFinding = {
	severity: AuditCrawlSeverity;
	kind: string;
	location: string;
	evidence: string;
	rawEvidence?: string;
	message: string;
	resourceId?: string;
};

export type AuditCrawlResourceKind =
	| "document"
	| "script"
	| "style"
	| "modulepreload"
	| "fetch"
	| "xhr"
	| "image"
	| "font"
	| "media"
	| "manifest"
	| "source-map"
	| "source-file"
	| "other";

export type AuditCrawlDiscoveryKind = "document" | "html" | "network" | "sourcemap" | "bundle-import";

export type AuditCrawlResourceNode = {
	id: string;
	kind: AuditCrawlResourceKind;
	url: string;
	label: string;
	status: string;
	discoveredBy: AuditCrawlDiscoveryKind;
	sameOrigin: boolean;
	scanned: boolean;
	isDynamic: boolean;
	contentType?: string;
	bytes?: number;
	parentUrl?: string;
	initiatorUrl?: string;
	note?: string;
	hasSourceMap: boolean;
	sourceMapUrl?: string;
};

export type AuditCrawlEdgeKind = "loads" | "imports" | "references-source-map" | "contains-source";

export type AuditCrawlEdge = {
	from: string;
	to: string;
	kind: AuditCrawlEdgeKind;
	note?: string;
};

export type AuditCrawlStats = {
	resourcesDiscovered: number;
	resourcesScanned: number;
	resourcesSkipped: number;
	inlineScriptsScanned: number;
	sourceMapsDiscovered: number;
	sourceMapsFetched: number;
	externalResources: number;
	dynamicResources: number;
};

export type AuditCrawlResult = {
	url: string;
	auditedAt: string;
	entryResourceId: string;
	findings: AuditCrawlFinding[];
	resources: AuditCrawlResourceNode[];
	edges: AuditCrawlEdge[];
	stats: AuditCrawlStats;
};

export type AuditCrawlLogger = Pick<Console, "info" | "warn" | "error">;

export type AuditCrawlRuntime = {
	attachKit<T>(kit: T, options?: { reason?: string }): Promise<T>;
	getCloakKit(): CloakKit | null;
	getStorageKit(): StorageKit | null;
};

type BrowserPageLease = {
	page: Page;
	close(): Promise<void>;
};

type NetworkRecord = {
	url: string;
	method: string;
	resourceType: string;
	status?: number;
	contentType?: string;
	bytes?: number;
	initiatorUrl?: string;
	response?: PlaywrightResponse;
	failedText?: string;
	request: PlaywrightRequest;
	order: number;
	frameUrl?: string;
	fromNavigation: boolean;
	fromHtml: boolean;
};

type ContentScanContext = {
	location: string;
	baseUrl: string;
	content: string;
	resourceId?: string;
	findings: AuditCrawlFinding[];
	seenFindings: Set<string>;
	sourceMapRefs: SourceMapReference[];
	imports: string[];
	mapUrl?: string;
};

type HtmlAssetReference = {
	kind: AuditCrawlResourceKind;
	url: string;
};

type SourceMapReference = {
	rawValue: string;
	resolvedUrl: string;
};

type ParsedSourceMap = {
	sources: string[];
	sourcesContentCount: number;
	sourceRoot?: string;
};

const DEV_ARTIFACT_PATTERNS: Array<{
	kind: string;
	severity: AuditCrawlSeverity;
	message: string;
	regex: RegExp;
}> = [
	{
		kind: "vite-dev-client",
		severity: "high",
		message: "Vite dev client reference leaked into the deployed application.",
		regex: /\/@vite\/client\b/gu,
	},
	{
		kind: "vite-hmr",
		severity: "high",
		message: "Hot Module Replacement code leaked into the deployed application.",
		regex: /\bimport\.meta\.hot\b/gu,
	},
	{
		kind: "vite-ping",
		severity: "high",
		message: "Vite HMR runtime marker leaked into the deployed application.",
		regex: /\b__vite_ping\b/gu,
	},
	{
		kind: "source-path",
		severity: "medium",
		message: "Raw /src/ file paths are still referenced by the deployed application.",
		regex: /\/src\/[A-Za-z0-9_./@-]+\.(?:[cm]?[jt]sx?|vue|s?css|less)/gu,
	},
	{
		kind: "node-modules-path",
		severity: "medium",
		message: "node_modules paths are referenced by the deployed bundle.",
		regex: /\/node_modules\/[A-Za-z0-9_./@-]+/gu,
	},
];

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	if (maxLength <= 3) {
		return value.slice(0, maxLength);
	}

	return `${value.slice(0, maxLength - 3)}...`;
}

function isBrowser(session: Browser | BrowserContext): session is Browser {
	return typeof (session as Browser).newContext === "function";
}

async function ensureCloakKit(runtime: AuditCrawlRuntime, reason: string): Promise<CloakKit> {
	let kit = runtime.getCloakKit();
	if (kit) {
		return kit;
	}

	kit = await runtime.attachKit(new CloakKit(), { reason });
	return kit;
}

async function ensureStorageKit(runtime: AuditCrawlRuntime, reason: string): Promise<StorageKit> {
	const existingKit = runtime.getStorageKit();
	if (existingKit) {
		return existingKit;
	}

	return await runtime.attachKit($storageKit, { reason });
}

async function openCloakPage(
	runtime: AuditCrawlRuntime,
	profileId: string,
	reason: string,
): Promise<BrowserPageLease> {
	const kit = await ensureCloakKit(runtime, reason);
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

function createResourceId(kind: AuditCrawlResourceKind, url: string): string {
	return `${kind}:${url}`;
}

function createSourceNodeId(mapUrl: string, sourcePath: string): string {
	return `source:${mapUrl}\u0000${sourcePath}`;
}

function normalizeOptionalInteger(value: unknown, paramName: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new InvalidParamsError(`Param '${paramName}' must be a positive integer.`);
	}

	return value;
}

function getLabelFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1);
		return lastSegment && lastSegment.length > 0 ? lastSegment : parsed.hostname;
	} catch {
		return url;
	}
}

function isPrivateIpv4Host(hostname: string): boolean {
	const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
	if (!match) {
		return false;
	}

	const octets = match.slice(1).map((value) => Number(value));
	if (octets.some((value) => value < 0 || value > 255)) {
		return false;
	}

	const [first = -1, second = -1] = octets;
	return first === 10
		|| (first === 192 && second === 168)
		|| (first === 172 && second >= 16 && second <= 31);
}

function isInternalHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return normalized.endsWith(".local")
		|| normalized.endsWith(".internal")
		|| normalized.endsWith(".lan")
		|| normalized.endsWith(".corp")
		|| normalized.endsWith(".home");
}

function isTextLikeContentType(contentType: string | undefined): boolean {
	if (!contentType) {
		return false;
	}

	const normalized = contentType.toLowerCase();
	return normalized.startsWith("text/")
		|| normalized.includes("javascript")
		|| normalized.includes("json")
		|| normalized.includes("xml")
		|| normalized.includes("svg")
		|| normalized.includes("html")
		|| normalized.includes("css");
}

function isSourceMapContentType(contentType: string | undefined): boolean {
	if (!contentType) {
		return false;
	}

	return contentType.toLowerCase().includes("json");
}

function shouldScanResource(kind: AuditCrawlResourceKind, contentType: string | undefined, url: string): boolean {
	if (kind === "image" || kind === "font" || kind === "media") {
		return false;
	}

	if (kind === "source-file") {
		return false;
	}

	if (url.endsWith(".map")) {
		return true;
	}

	if (isTextLikeContentType(contentType)) {
		return true;
	}

	return /\.(?:[cm]?[jt]sx?|css|json|html?|svg|map)(?:$|[?#])/iu.test(url);
}

function normalizeResourceKind(resourceType: string): AuditCrawlResourceKind {
	switch (resourceType) {
		case "document":
			return "document";
		case "script":
			return "script";
		case "stylesheet":
			return "style";
		case "fetch":
			return "fetch";
		case "xhr":
			return "xhr";
		case "image":
			return "image";
		case "font":
			return "font";
		case "media":
			return "media";
		case "manifest":
			return "manifest";
		default:
			return "other";
	}
}

function collectHtmlAssets(
	html: string,
	entryUrl: URL,
): { assets: HtmlAssetReference[]; inlineScripts: string[] } {
	const $ = load(html);
	const assets: HtmlAssetReference[] = [];
	const seen = new Set<string>();

	const pushAsset = (kind: AuditCrawlResourceKind, rawValue: string | undefined) => {
		if (!rawValue) {
			return;
		}

		try {
			const resolved = new URL(rawValue, entryUrl).href;
			if (seen.has(`${kind}\u0000${resolved}`)) {
				return;
			}

			seen.add(`${kind}\u0000${resolved}`);
			assets.push({ kind, url: resolved });
		} catch {
			return;
		}
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

	return { assets, inlineScripts };
}

function createDocumentScanContent(html: string): string {
	const $ = load(html);
	$("script:not([src])").remove();
	return $.html();
}

function extractSourceMapReferences(content: string, baseUrl: string): SourceMapReference[] {
	const references: SourceMapReference[] = [];
	const seenUrls = new Set<string>();

	for (const match of content.matchAll(/sourceMappingURL=([^\s*]+)/gu)) {
		const rawValue = match[1]?.trim().replace(/["'`)]$/u, "");
		if (!rawValue || rawValue.startsWith("data:")) {
			continue;
		}

		let resolved: URL;
		try {
			resolved = new URL(rawValue, baseUrl);
		} catch {
			continue;
		}

		if (seenUrls.has(resolved.href)) {
			continue;
		}

		seenUrls.add(resolved.href);
		references.push({ rawValue, resolvedUrl: resolved.href });
	}

	return references;
}

function extractBundleImportSpecifiers(content: string, baseUrl: string): string[] {
	const imports = new Set<string>();
	const patterns = [
		/(?:import|export)\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/gu,
		/\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gu,
	];

	for (const pattern of patterns) {
		for (const match of content.matchAll(pattern)) {
			const rawValue = match[1]?.trim();
			if (!rawValue || rawValue.startsWith("node:")) {
				continue;
			}

			try {
				imports.add(new URL(rawValue, baseUrl).href);
			} catch {
				continue;
			}
		}
	}

	return [...imports];
}

function parseSourceMap(content: string): ParsedSourceMap {
	const parsed = JSON.parse(content) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Source map payload must be an object.");
	}

	const record = parsed as Record<string, unknown>;
	const sources = Array.isArray(record.sources)
		? record.sources.filter((value): value is string => typeof value === "string" && value.length > 0)
		: [];
	const sourcesContentCount = Array.isArray(record.sourcesContent)
		? record.sourcesContent.filter((value) => typeof value === "string" && value.length > 0).length
		: 0;

	return {
		sources,
		sourcesContentCount,
		sourceRoot: typeof record.sourceRoot === "string" ? record.sourceRoot : undefined,
	};
}

function pushFinding(
	findings: AuditCrawlFinding[],
	seenFindings: Set<string>,
	finding: AuditCrawlFinding,
): void {
	pushAuditFinding(findings, seenFindings, finding);
}

function scanDevArtifacts(context: ContentScanContext): void {
	for (const pattern of DEV_ARTIFACT_PATTERNS) {
		for (const match of collectAuditPatternMatches(pattern.regex, context.content, MAX_MATCHES_PER_PATTERN)) {
			pushFinding(context.findings, context.seenFindings, {
				severity: pattern.severity,
				kind: pattern.kind,
				location: context.location,
				evidence: truncate(match, 88),
				message: pattern.message,
				resourceId: context.resourceId,
			});
		}
	}
}

function scanLeakedUrls(context: ContentScanContext): void {
	for (const leakedUrl of collectAuditPatternMatches(/(?:https?|wss?):\/\/[^\s"'`<>)]+/gu, context.content, MAX_MATCHES_PER_PATTERN)) {
		let parsed: URL;
		try {
			parsed = new URL(leakedUrl);
		} catch {
			continue;
		}

		const hostname = parsed.hostname.toLowerCase();
		if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1") {
			pushFinding(context.findings, context.seenFindings, {
				severity: "high",
				kind: "localhost-url",
				location: context.location,
				evidence: truncate(leakedUrl, 88),
				message: "Client bundle references localhost, which usually indicates a bad dev/proxy configuration in production.",
				resourceId: context.resourceId,
			});
			continue;
		}

		if (isPrivateIpv4Host(hostname)) {
			pushFinding(context.findings, context.seenFindings, {
				severity: "high",
				kind: "private-network-url",
				location: context.location,
				evidence: truncate(leakedUrl, 88),
				message: "Client bundle references a private-network address.",
				resourceId: context.resourceId,
			});
			continue;
		}

		if (isInternalHostname(hostname)) {
			pushFinding(context.findings, context.seenFindings, {
				severity: "medium",
				kind: "internal-host-url",
				location: context.location,
				evidence: truncate(leakedUrl, 88),
				message: "Client bundle references an internal hostname.",
				resourceId: context.resourceId,
			});
		}
	}
}

function scanViteEnvKeys(context: ContentScanContext): void {
	const seenKeys = new Set<string>();
	for (const match of context.content.matchAll(/\bVITE_[A-Z0-9_]{2,}\b/gu)) {
		const key = match[0];
		if (!key || seenKeys.has(key)) {
			continue;
		}

		seenKeys.add(key);
		const suspiciousName = /(?:SECRET|TOKEN|PASSWORD|AUTH|PRIVATE|KEY)/u.test(key);
		pushFinding(context.findings, context.seenFindings, {
			severity: suspiciousName ? "medium" : "low",
			kind: suspiciousName ? "vite-env-sensitive-name" : "vite-env-key",
			location: context.location,
			evidence: key,
			message: suspiciousName
				? "Suspicious Vite client env key name suggests sensitive data may have been exposed to the client bundle."
				: "Vite client env key name appears in the deployed bundle.",
			resourceId: context.resourceId,
		});

		if (seenKeys.size >= MAX_MATCHES_PER_PATTERN) {
			break;
		}
	}
}

function scanKnownSecrets(context: ContentScanContext): void {
	const detections = collectAuditSecretDetections(
		context.content,
		AUDIT_SECRET_DETECTORS,
		MAX_MATCHES_PER_PATTERN,
	);
	const detectedSecrets = new Set(detections.map((detection) => detection.value));

	for (const detection of detections) {
		pushFinding(context.findings, context.seenFindings, {
			severity: detection.severity,
			kind: detection.kind,
			location: context.location,
			evidence: maskAuditSecret(detection.value),
			rawEvidence: detection.value,
			message: detection.message,
			resourceId: context.resourceId,
		});
	}

	for (const match of context.content.matchAll(/(?:api[_-]?key|secret|token|password|bearer|authorization)[^\n]{0,40}?["'`]([A-Za-z0-9._~+\-/=:@]{12,})["'`]/giu)) {
		const secretValue = match[1];
		if (!secretValue || detectedSecrets.has(secretValue)) {
			continue;
		}

		pushFinding(context.findings, context.seenFindings, {
			severity: "medium",
			kind: "secret-like-literal",
			location: context.location,
			evidence: maskAuditSecret(secretValue),
			rawEvidence: secretValue,
			message: "Secret-like literal is embedded near a sensitive key name in the client bundle.",
			resourceId: context.resourceId,
		});
		break;
	}
}

async function persistAuditCrawlFindings(
	runtime: AuditCrawlRuntime,
	entryUrl: string,
	auditedAt: string,
	findings: readonly AuditCrawlFinding[],
	resources: ReadonlyMap<string, AuditCrawlResourceNode>,
): Promise<void> {
	if (findings.length === 0) {
		return;
	}

	const storageKit = await ensureStorageKit(runtime, "module:audit/crawl:persist-findings");
	storageKit.insertAuditCrawlFindings(findings.map((finding) => {
		const resource = finding.resourceId ? resources.get(finding.resourceId) ?? null : null;
		return {
			entryUrl,
			auditedAt,
			resourceId: finding.resourceId ?? null,
			resourceKind: resource?.kind ?? null,
			resourceLabel: resource?.label ?? null,
			resourceUrl: resource?.url ?? null,
			severity: finding.severity,
			kind: finding.kind,
			location: finding.location,
			evidence: finding.evidence,
			rawEvidence: finding.rawEvidence ?? finding.evidence,
			message: finding.message,
		};
	}));
}

function scanSourceMapReferences(context: ContentScanContext): void {
	for (const reference of extractSourceMapReferences(context.content, context.baseUrl)) {
		context.sourceMapRefs.push(reference);
		pushFinding(context.findings, context.seenFindings, {
			severity: "medium",
			kind: "source-map-reference",
			location: context.location,
			evidence: truncate(reference.resolvedUrl, 88),
			message: "Bundle references a source map that may expose original source files in production.",
			resourceId: context.resourceId,
		});
	}
}

function scanBundleImports(context: ContentScanContext): void {
	for (const importUrl of extractBundleImportSpecifiers(context.content, context.baseUrl)) {
		context.imports.push(importUrl);
	}
}

function scanSourceRoot(
	mapUrl: string,
	sourceRoot: string | undefined,
	findings: AuditCrawlFinding[],
	seenFindings: Set<string>,
	resourceId: string,
): void {
	if (!sourceRoot) {
		return;
	}

	let resolvedUrl: URL | null = null;
	try {
		resolvedUrl = new URL(sourceRoot, mapUrl);
	} catch {
		resolvedUrl = null;
	}

	if (!resolvedUrl) {
		if (/^(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/|\/var\/|\/srv\/|\/opt\/)/u.test(sourceRoot)) {
			pushFinding(findings, seenFindings, {
				severity: "high",
				kind: "source-root-filesystem-path",
				location: mapUrl,
				evidence: truncate(sourceRoot, 88),
				message: "Source map exposes an absolute filesystem sourceRoot.",
				resourceId,
			});
		}
		return;
	}

	const hostname = resolvedUrl.hostname.toLowerCase();
	if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1") {
		pushFinding(findings, seenFindings, {
			severity: "high",
			kind: "source-root-localhost",
			location: mapUrl,
			evidence: truncate(resolvedUrl.href, 88),
			message: "Source map sourceRoot points at localhost.",
			resourceId,
		});
		return;
	}

	if (isPrivateIpv4Host(hostname) || isInternalHostname(hostname)) {
		pushFinding(findings, seenFindings, {
			severity: "medium",
			kind: "source-root-internal-host",
			location: mapUrl,
			evidence: truncate(resolvedUrl.href, 88),
			message: "Source map sourceRoot points at an internal or private host.",
			resourceId,
		});
	}
}

function scanContent(context: ContentScanContext): void {
	scanSourceMapReferences(context);
	scanDevArtifacts(context);
	scanLeakedUrls(context);
	scanViteEnvKeys(context);
	scanKnownSecrets(context);
	scanBundleImports(context);
}

function resolveSourcePath(mapUrl: string, sourceRoot: string | undefined, sourcePath: string): string {
	if (/^(?:https?:)?\/\//u.test(sourcePath)) {
		return sourcePath;
	}

	if (/^(?:webpack:|vite:|file:|node:|npm:|virtual:)/u.test(sourcePath)) {
		return sourcePath;
	}

	try {
		return new URL(sourcePath, sourceRoot ? new URL(sourceRoot, mapUrl) : mapUrl).href;
	} catch {
		return sourceRoot ? `${sourceRoot.replace(/\/$/u, "")}/${sourcePath.replace(/^\.\//u, "")}` : sourcePath;
	}
}

async function fetchSourceMapResource(
	mapUrl: string,
	params: ResolvedAuditTraversalParams,
): Promise<{ content: string; bytes: number; contentType?: string; status: number }> {
	const resource = await fetchTextResource(mapUrl, params.timeoutMs, params.maxAssetBytes);
	return {
		content: resource.content,
		bytes: resource.bytes,
		contentType: resource.contentType,
		status: resource.status,
	};
}

async function captureBrowserNetwork(
	runtime: AuditCrawlRuntime,
	logger: AuditCrawlLogger,
	params: ResolvedAuditTraversalParams,
): Promise<{
		documentUrl: string;
		documentContent: string;
		documentStatus: number;
		documentContentType?: string;
		documentBytes: number;
		networkRecords: NetworkRecord[];
		inlineScripts: string[];
		htmlAssets: HtmlAssetReference[];
	}> {
	const lease = await openCloakPage(runtime, params.cloakProfileId!, "audit/crawl traversal");
	const recordsByUrl = new Map<string, NetworkRecord>();
	let order = 0;

	const ensureRecord = (request: PlaywrightRequest): NetworkRecord => {
		const existing = recordsByUrl.get(request.url());
		if (existing) {
			return existing;
		}

		let initiatorUrl: string | undefined;
		try {
			initiatorUrl = request.frame()?.url() || undefined;
		} catch {
			initiatorUrl = undefined;
		}

		const record: NetworkRecord = {
			url: request.url(),
			method: request.method(),
			resourceType: request.resourceType(),
			initiatorUrl,
			request,
			order: order++,
			frameUrl: initiatorUrl,
			fromNavigation: request.isNavigationRequest(),
			fromHtml: false,
		};
		recordsByUrl.set(request.url(), record);
		return record;
	};

	const handleRequest = (request: PlaywrightRequest) => {
		ensureRecord(request);
	};

	const handleResponse = (response: PlaywrightResponse) => {
		const request = response.request();
		const record = ensureRecord(request);
		const headers = response.headers();
		record.response = response;
		record.status = response.status();
		record.contentType = headers["content-type"];
		const contentLengthHeader = headers["content-length"];
		if (typeof contentLengthHeader === "string") {
			const parsedLength = Number.parseInt(contentLengthHeader, 10);
			if (Number.isFinite(parsedLength) && parsedLength >= 0) {
				record.bytes = parsedLength;
			}
		}
		logger.info({ url: request.url(), status: record.status, type: request.resourceType() }, "Captured crawl response");
	};

	const handleRequestFailed = (request: PlaywrightRequest) => {
		const record = ensureRecord(request);
		record.failedText = request.failure()?.errorText ?? "Request failed";
		logger.warn({ url: request.url(), type: request.resourceType(), error: record.failedText }, "Crawl request failed");
	};

	lease.page.on("request", handleRequest);
	lease.page.on("response", handleResponse);
	lease.page.on("requestfailed", handleRequestFailed);

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
		const html = collectHtmlAssets(content, new URL(lease.page.url()));
		for (const asset of html.assets) {
			const record = recordsByUrl.get(asset.url);
			if (record) {
				record.fromHtml = true;
			}
		}

		return {
			documentUrl: lease.page.url(),
			documentContent: content,
			documentStatus: response?.status() ?? 200,
			documentContentType: response?.headers()["content-type"],
			documentBytes: Buffer.byteLength(content, "utf8"),
			networkRecords: [...recordsByUrl.values()].sort((left, right) => left.order - right.order),
			inlineScripts: html.inlineScripts,
			htmlAssets: html.assets,
		};
	} finally {
		lease.page.off("request", handleRequest);
		lease.page.off("response", handleResponse);
		lease.page.off("requestfailed", handleRequestFailed);
		await lease.close().catch(() => {});
	}
}

export async function executeAuditCrawl(
	runtime: AuditCrawlRuntime,
	logger: AuditCrawlLogger,
	params: AuditCrawlParams,
): Promise<AuditCrawlResult> {
	const resolved = resolveAuditTraversalParams(params);
	const findings: AuditCrawlFinding[] = [];
	const seenFindings = new Set<string>();
	const edges: AuditCrawlEdge[] = [];
	const edgeKeys = new Set<string>();
	const resources = new Map<string, AuditCrawlResourceNode>();
	const processedContent = new Set<string>();
	let resourcesDiscovered = 0;
	let resourcesScanned = 0;
	let resourcesSkipped = 0;
	let externalResources = 0;
	let dynamicResources = 0;
	let sourceMapsDiscovered = 0;
	let sourceMapsFetched = 0;
	let entryResourceId = "";
	let baseEntryUrl = resolved.entryUrl.href;
	let inlineScripts: string[] = [];

	const pushEdge = (edge: AuditCrawlEdge) => {
		const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;
		if (edgeKeys.has(key)) {
			return;
		}

		edgeKeys.add(key);
		edges.push(edge);
	};

	const upsertResource = (input: AuditCrawlResourceNode): AuditCrawlResourceNode => {
		const existing = resources.get(input.id);
		if (!existing) {
			resources.set(input.id, input);
			resourcesDiscovered += 1;
			if (!input.sameOrigin) {
				externalResources += 1;
			}
			if (input.isDynamic) {
				dynamicResources += 1;
			}
			return input;
		}

		const nextNode: AuditCrawlResourceNode = {
			...existing,
			...input,
			contentType: input.contentType ?? existing.contentType,
			bytes: input.bytes ?? existing.bytes,
			note: input.note ?? existing.note,
			parentUrl: input.parentUrl ?? existing.parentUrl,
			initiatorUrl: input.initiatorUrl ?? existing.initiatorUrl,
			hasSourceMap: existing.hasSourceMap || input.hasSourceMap,
			sourceMapUrl: input.sourceMapUrl ?? existing.sourceMapUrl,
			scanned: existing.scanned || input.scanned,
			isDynamic: existing.isDynamic || input.isDynamic,
			discoveredBy: existing.discoveredBy === "document" ? existing.discoveredBy : input.discoveredBy,
		};
		resources.set(input.id, nextNode);
		return nextNode;
	};

	const addSourceNodes = (mapNode: AuditCrawlResourceNode, parsedMap: ParsedSourceMap) => {
		for (const sourcePath of parsedMap.sources) {
			const resolvedSourcePath = resolveSourcePath(mapNode.url, parsedMap.sourceRoot, sourcePath);
			const sourceNode = upsertResource({
				id: createSourceNodeId(mapNode.url, sourcePath),
				kind: "source-file",
				url: resolvedSourcePath,
				label: getLabelFromUrl(sourcePath),
				status: parsedMap.sourcesContentCount > 0 ? "mapped" : "referenced",
				discoveredBy: "sourcemap",
				sameOrigin: resolvedSourcePath.startsWith(baseEntryUrl.split("/").slice(0, 3).join("/")),
				scanned: false,
				isDynamic: false,
				hasSourceMap: false,
				note: sourcePath,
			});
			pushEdge({ from: mapNode.id, to: sourceNode.id, kind: "contains-source" });
		}
	};

	const scanResourceContent = async (
		resource: AuditCrawlResourceNode,
		content: string,
	): Promise<void> => {
		if (processedContent.has(resource.id)) {
			return;
		}

		processedContent.add(resource.id);
		resourcesScanned += 1;
		upsertResource({ ...resource, scanned: true });

		const sourceMapRefs: SourceMapReference[] = [];
		const imports: string[] = [];
		scanContent({
			location: resource.url,
			baseUrl: resource.url,
			content,
			resourceId: resource.id,
			findings,
			seenFindings,
			sourceMapRefs,
			imports,
		});

		for (const importUrl of imports) {
			const importedNode = upsertResource({
				id: createResourceId("script", importUrl),
				kind: "script",
				url: importUrl,
				label: getLabelFromUrl(importUrl),
				status: "referenced",
				discoveredBy: "bundle-import",
				sameOrigin: new URL(importUrl, baseEntryUrl).origin === new URL(baseEntryUrl).origin,
				scanned: false,
				isDynamic: true,
				hasSourceMap: false,
				initiatorUrl: resource.url,
			});
			pushEdge({ from: resource.id, to: importedNode.id, kind: "imports" });
		}

		for (const reference of sourceMapRefs) {
			sourceMapsDiscovered += 1;
			const mapNode = upsertResource({
				id: createResourceId("source-map", reference.resolvedUrl),
				kind: "source-map",
				url: reference.resolvedUrl,
				label: getLabelFromUrl(reference.resolvedUrl),
				status: "discovered",
				discoveredBy: "sourcemap",
				sameOrigin: new URL(reference.resolvedUrl, baseEntryUrl).origin === new URL(baseEntryUrl).origin,
				scanned: false,
				isDynamic: false,
				hasSourceMap: false,
				parentUrl: resource.url,
				initiatorUrl: resource.url,
				note: reference.rawValue === reference.resolvedUrl ? undefined : reference.rawValue,
			});
			pushEdge({ from: resource.id, to: mapNode.id, kind: "references-source-map" });
			upsertResource({ ...resource, hasSourceMap: true, sourceMapUrl: reference.resolvedUrl });

			if (!mapNode.sameOrigin && resolved.sameOriginOnly) {
				resourcesSkipped += 1;
				continue;
			}

			try {
				const mapResource = await fetchSourceMapResource(reference.resolvedUrl, resolved);
				sourceMapsFetched += 1;
				upsertResource({
					...mapNode,
					status: String(mapResource.status),
					bytes: mapResource.bytes,
					contentType: mapResource.contentType,
				});
				if (!shouldScanResource(mapNode.kind, mapResource.contentType, mapNode.url)) {
					continue;
				}

				const parsedMap = parseSourceMap(mapResource.content);
				scanKnownSecrets({
					location: mapNode.url,
					baseUrl: mapNode.url,
					content: mapResource.content,
					resourceId: mapNode.id,
					findings,
					seenFindings,
					sourceMapRefs: [],
					imports: [],
				});
				scanSourceRoot(mapNode.url, parsedMap.sourceRoot, findings, seenFindings, mapNode.id);
				addSourceNodes(mapNode, parsedMap);
				processedContent.add(mapNode.id);
				resourcesScanned += 1;
				upsertResource({ ...mapNode, scanned: true });
			} catch (error) {
				upsertResource({
					...mapNode,
					status: "failed",
					note: error instanceof Error ? error.message : String(error),
				});
				logger.warn({ url: reference.resolvedUrl, error: error instanceof Error ? error.message : String(error) }, "Failed to fetch crawl source map");
			}
		}
	};

	if (resolved.fetchMode === "browser") {
		const captured = await captureBrowserNetwork(runtime, logger, resolved);
		baseEntryUrl = captured.documentUrl;
		inlineScripts = captured.inlineScripts;

		const entryNode = upsertResource({
			id: createResourceId("document", captured.documentUrl),
			kind: "document",
			url: captured.documentUrl,
			label: getLabelFromUrl(captured.documentUrl),
			status: String(captured.documentStatus),
			discoveredBy: "document",
			sameOrigin: true,
			scanned: false,
			isDynamic: false,
			contentType: captured.documentContentType,
			bytes: captured.documentBytes,
			hasSourceMap: false,
		});
		entryResourceId = entryNode.id;
		await scanResourceContent(entryNode, createDocumentScanContent(captured.documentContent));

		const htmlKindByUrl = new Map<string, AuditCrawlResourceKind>();
		for (const asset of captured.htmlAssets) {
			htmlKindByUrl.set(asset.url, asset.kind);
		}

		for (const record of captured.networkRecords) {
			if (record.url === captured.documentUrl && record.fromNavigation) {
				continue;
			}

			const sameOrigin = new URL(record.url, captured.documentUrl).origin === new URL(captured.documentUrl).origin;
			const kind = htmlKindByUrl.get(record.url) ?? normalizeResourceKind(record.resourceType);
			const isDynamic = !htmlKindByUrl.has(record.url);
			const resource = upsertResource({
				id: createResourceId(kind, record.url),
				kind,
				url: record.url,
				label: getLabelFromUrl(record.url),
				status: record.failedText ? "failed" : String(record.status ?? "pending"),
				discoveredBy: record.fromHtml ? "html" : "network",
				sameOrigin,
				scanned: false,
				isDynamic,
				contentType: record.contentType,
				bytes: record.bytes,
				initiatorUrl: record.initiatorUrl,
				parentUrl: record.frameUrl,
				note: record.failedText,
				hasSourceMap: false,
			});

			pushEdge({
				from: entryNode.id,
				to: resource.id,
				kind: "loads",
				note: record.resourceType,
			});

			if (record.failedText || !record.response) {
				resourcesSkipped += 1;
				continue;
			}

			if (!sameOrigin && resolved.sameOriginOnly) {
				resourcesSkipped += 1;
				continue;
			}

			if (!shouldScanResource(resource.kind, record.contentType, resource.url)) {
				continue;
			}

			if (processedContent.size >= resolved.maxAssets + 1) {
				resourcesSkipped += 1;
				continue;
			}

			try {
				const content = await record.response.text();
				if (resource.bytes === undefined) {
					upsertResource({ ...resource, bytes: Buffer.byteLength(content, "utf8") });
				}
				await scanResourceContent(resource, content);
			} catch (error) {
				resourcesSkipped += 1;
				upsertResource({ ...resource, note: error instanceof Error ? error.message : String(error) });
			}
		}
	} else {
		const document = await fetchTextResource(resolved.entryUrl.href, resolved.timeoutMs, resolved.maxAssetBytes);
		baseEntryUrl = document.url;
		const entryNode = upsertResource({
			id: createResourceId("document", document.url),
			kind: "document",
			url: document.url,
			label: getLabelFromUrl(document.url),
			status: String(document.status),
			discoveredBy: "document",
			sameOrigin: true,
			scanned: false,
			isDynamic: false,
			contentType: document.contentType,
			bytes: document.bytes,
			hasSourceMap: false,
		});
		entryResourceId = entryNode.id;

		const html = collectHtmlAssets(document.content, new URL(document.url));
		inlineScripts = html.inlineScripts;
		await scanResourceContent(entryNode, createDocumentScanContent(document.content));

		for (const asset of html.assets.slice(0, resolved.maxAssets)) {
			const sameOrigin = new URL(asset.url, document.url).origin === new URL(document.url).origin;
			const resource = upsertResource({
				id: createResourceId(asset.kind, asset.url),
				kind: asset.kind,
				url: asset.url,
				label: getLabelFromUrl(asset.url),
				status: "discovered",
				discoveredBy: "html",
				sameOrigin,
				scanned: false,
				isDynamic: false,
				parentUrl: document.url,
				initiatorUrl: document.url,
				hasSourceMap: false,
			});
			pushEdge({ from: entryNode.id, to: resource.id, kind: "loads" });

			if (!sameOrigin && resolved.sameOriginOnly) {
				resourcesSkipped += 1;
				continue;
			}

			try {
				const assetResource = await fetchTextResource(asset.url, resolved.timeoutMs, resolved.maxAssetBytes);
				upsertResource({
					...resource,
					status: String(assetResource.status),
					bytes: assetResource.bytes,
					contentType: assetResource.contentType,
				});
				if (!shouldScanResource(resource.kind, assetResource.contentType, resource.url)) {
					continue;
				}
				await scanResourceContent(resource, assetResource.content);
			} catch (error) {
				resourcesSkipped += 1;
				upsertResource({
					...resource,
					status: "failed",
					note: error instanceof Error ? error.message : String(error),
				});
			}
		}
		resourcesSkipped += Math.max(html.assets.length - Math.min(html.assets.length, resolved.maxAssets), 0);
	}

	for (const [index, inlineScript] of inlineScripts.entries()) {
		scanContent({
			location: `${baseEntryUrl}#inline-script-${index + 1}`,
			baseUrl: baseEntryUrl,
			content: inlineScript,
			resourceId: entryResourceId,
			findings,
			seenFindings,
			sourceMapRefs: [],
			imports: [],
		});
		resourcesScanned += 1;
	}

	const auditedAt = new Date().toISOString();
	const sortedFindings = sortAuditFindings(findings);
	const sortedResources = [...resources.values()].sort((left, right) => left.url.localeCompare(right.url));

	await persistAuditCrawlFindings(runtime, baseEntryUrl, auditedAt, sortedFindings, resources);

	return {
		url: baseEntryUrl,
		auditedAt,
		entryResourceId,
		findings: sortedFindings,
		resources: sortedResources,
		edges,
		stats: {
			resourcesDiscovered,
			resourcesScanned,
			resourcesSkipped,
			inlineScriptsScanned: inlineScripts.length,
			sourceMapsDiscovered,
			sourceMapsFetched,
			externalResources,
			dynamicResources,
		},
	};
}