import fs from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext } from "playwright-core";
import { $axios } from "../../axios";
import { CloakKit } from "../../kits";
import { createTableEntity, createTextEntity, type OutputEntity } from "../../primitives";
import { InvalidParamsError } from "../errors";
import { defineExecutor, defineModule, type ModuleConsoleParam, type ModuleExecutionContext } from "../module";
import { DISCOVERY_NOTEBOOK_TYPE_OVERLAY } from "./notebook-overlay";

const DEFAULT_TOP = 100;
const DEFAULT_TIMEOUT_MS = 15000;
const RADAR_HOME_URL = "https://radar.cloudflare.com/";
const RADAR_ATTACHMENT_URL = "https://radar.cloudflare.com/charts/TopDomainsTable/attachment";
const RADAR_OUTPUT_ROOT = path.resolve(process.cwd(), "data", "cloudflare-radar", "domains");
const RADAR_CHALLENGE_MARKERS = [
	"Just a moment...",
	"Enable JavaScript and cookies to continue",
	"_cf_chl_opt",
];

type RadarFetchMode = "auto" | "http" | "browser";

export type CloudflareRadarDomainsPullParams = {
	top?: number;
	value?: number;
	dateEnd?: string;
	timeoutMs?: number;
	fetchMode?: RadarFetchMode;
	cloakProfileId?: string;
};

export type CloudflareRadarDomainsSearchParams = CloudflareRadarDomainsPullParams & {
	pattern?: string;
	query?: string;
};

type RadarDomainEntry = {
	rank: number | null;
	domain: string;
};

type RadarDownloadResult = {
	entries: RadarDomainEntry[];
	dateEnd: string;
	top: number;
	sourceUrl: string;
	fetchMode: Exclude<RadarFetchMode, "auto">;
	contentType?: string;
	fetchedAt: string;
	usedBrowserFallback: boolean;
};

type RadarSavedArtifacts = {
	directoryPath: string;
	jsonPath: string;
	textPath: string;
};

type BrowserPageLease = {
	close(): Promise<void>;
	page: import("playwright-core").Page;
};

type BrowserTextResponse = {
	contentType?: string;
	status: number;
	text: string;
	url: string;
};

const RADAR_PULL_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "top",
		detail: "Top N domains to request from Radar.",
		valueType: "number",
		example: "top=1000",
	},
	{
		name: "value",
		detail: "Alias for top used by the upstream attachment query.",
		valueType: "number",
		example: "value=500",
	},
	{
		name: "dateEnd",
		detail: "ISO day for the dataset snapshot.",
		valueType: "string",
		example: "dateEnd=2026-04-29",
	},
	{
		name: "timeoutMs",
		detail: "Request timeout in milliseconds.",
		valueType: "number",
		example: "timeoutMs=30000",
	},
	{
		name: "fetchMode",
		detail: "Choose plain HTTP, browser mode, or auto fallback.",
		valueType: "string",
		values: ["auto", "http", "browser"],
		example: "fetchMode=browser",
	},
	{
		name: "cloakProfileId",
		detail: "Cloak profile id or name used for browser fetches and challenge fallback.",
		valueType: "string",
		example: "cloakProfileId=cf",
	},
];

const RADAR_SEARCH_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "pattern",
		detail: "Wildcard pattern used to filter domains after download.",
		valueType: "string",
		example: "pattern=*.gov",
	},
	{
		name: "query",
		detail: "Alias for pattern.",
		valueType: "string",
		example: "query=hello*.com",
	},
	...RADAR_PULL_CONSOLE_PARAMS,
];

function readOptionalPositiveInteger(value: unknown, paramName: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new InvalidParamsError(`Param '${paramName}' must be a positive integer.`);
	}

	return value;
}

function readOptionalNonEmptyString(value: unknown, paramName: string): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "string" || value.trim().length === 0) {
		throw new InvalidParamsError(`Param '${paramName}' must be a non-empty string.`);
	}

	return value.trim();
}

function readFetchMode(value: unknown): RadarFetchMode {
	if (value === undefined) {
		return "auto";
	}

	if (value !== "auto" && value !== "http" && value !== "browser") {
		throw new InvalidParamsError("Param 'fetchMode' must be one of: auto, http, browser.");
	}

	return value;
}

function isValidIsoDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
		return false;
	}

	const date = new Date(`${value}T00:00:00`);
	if (Number.isNaN(date.getTime())) {
		return false;
	}

	const year = String(date.getFullYear()).padStart(4, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}` === value;
}

function formatTodayDate(): string {
	const now = new Date();
	const year = String(now.getFullYear()).padStart(4, "0");
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function formatFileTimestamp(value: string): string {
	const timestamp = new Date(value);
	if (Number.isNaN(timestamp.getTime())) {
		return value.replace(/[^0-9A-Za-z._-]+/gu, "-");
	}

	return timestamp.toISOString().replace(/[:]/gu, "-");
}

function toProjectPath(filePath: string): string {
	const relativePath = path.relative(process.cwd(), filePath);
	if (relativePath.length === 0 || relativePath.startsWith("..")) {
		return filePath;
	}

	return relativePath;
}

function readDateEnd(value: unknown): string {
	if (value === undefined) {
		return formatTodayDate();
	}

	if (typeof value !== "string" || !isValidIsoDate(value.trim())) {
		throw new InvalidParamsError("Param 'dateEnd' must be an ISO date in YYYY-MM-DD format.");
	}

	return value.trim();
}

function readTopValue(params: { top?: unknown; value?: unknown }): number {
	return readOptionalPositiveInteger(params.top, "top")
		?? readOptionalPositiveInteger(params.value, "value")
		?? DEFAULT_TOP;
}

function readTimeoutMs(value: unknown): number {
	return readOptionalPositiveInteger(value, "timeoutMs") ?? DEFAULT_TIMEOUT_MS;
}

function readSearchPattern(params: CloudflareRadarDomainsSearchParams): string {
	const pattern = readOptionalNonEmptyString(params.pattern ?? params.query, "pattern");
	if (!pattern) {
		throw new InvalidParamsError("Param 'pattern' is required. Example: hello*.com");
	}

	return pattern;
}

function buildAttachmentUrl(top: number, dateEnd: string): string {
	const searchParams = new URLSearchParams({
		value: String(top),
		dateEnd,
	});

	return `${RADAR_ATTACHMENT_URL}?${searchParams.toString()}`;
}

function stripBom(value: string): string {
	return value.replace(/^\uFEFF/u, "");
}

function looksLikeCloudflareChallenge(text: string): boolean {
	return RADAR_CHALLENGE_MARKERS.some(marker => text.includes(marker));
}

function normalizeDomain(value: string): string | null {
	const trimmed = value.trim().replace(/^['"]|['"]$/gu, "");
	if (trimmed.length === 0) {
		return null;
	}

	const withoutProtocol = trimmed.replace(/^https?:\/\//iu, "");
	const withoutPath = withoutProtocol.split(/[/?#]/u)[0]?.trim().toLowerCase() ?? "";
	if (withoutPath.length === 0 || /\s/u.test(withoutPath)) {
		return null;
	}

	return withoutPath;
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
	const cells: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (character === '"') {
			if (inQuotes && line[index + 1] === '"') {
				current += '"';
				index += 1;
				continue;
			}

			inQuotes = !inQuotes;
			continue;
		}

		if (character === delimiter && !inQuotes) {
			cells.push(current.trim());
			current = "";
			continue;
		}

		current += character;
	}

	cells.push(current.trim());
	return cells;
}

function normalizeHeader(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9#]+/gu, "");
}

function isRankHeader(value: string): boolean {
	return ["rank", "position", "index", "#", "top"].includes(value);
}

function isDomainHeader(value: string): boolean {
	return ["domain", "hostname", "host", "name"].includes(value);
}

function parseRankValue(value: string | undefined, fallbackRank: number): number | null {
	if (!value) {
		return fallbackRank;
	}

	const digits = value.trim().match(/^\d+$/u);
	if (!digits) {
		return fallbackRank;
	}

	return Number(digits[0]);
}

function parseJsonEntries(rawText: string): RadarDomainEntry[] | null {
	const trimmed = rawText.trim();
	if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}

	const candidateArrays: unknown[] = [];
	if (Array.isArray(parsed)) {
		candidateArrays.push(parsed);
	} else if (parsed && typeof parsed === "object") {
		const record = parsed as Record<string, unknown>;
		for (const key of ["data", "domains", "items", "results"]) {
			const value = record[key];
			if (Array.isArray(value)) {
				candidateArrays.push(value);
			}
		}
	}

	for (const candidate of candidateArrays) {
		const entries = (candidate as unknown[])
			.map((item, index) => {
				if (typeof item === "string") {
					const domain = normalizeDomain(item);
					return domain ? { rank: index + 1, domain } : null;
				}

				if (!item || typeof item !== "object") {
					return null;
				}

				const record = item as Record<string, unknown>;
				const rawDomain = [record.domain, record.hostname, record.host, record.name]
					.find(value => typeof value === "string");
				const domain = typeof rawDomain === "string" ? normalizeDomain(rawDomain) : null;
				if (!domain) {
					return null;
				}

				const rawRank = [record.rank, record.position, record.index, record.top]
					.find(value => typeof value === "number" || typeof value === "string");
				const rank = typeof rawRank === "number"
					? rawRank
					: parseRankValue(typeof rawRank === "string" ? rawRank : undefined, index + 1);

				return { rank, domain };
			})
			.filter((entry): entry is RadarDomainEntry => entry !== null);

		if (entries.length > 0) {
			return dedupeEntries(entries);
		}
	}

	return null;
}

function detectDelimiter(line: string): string | null {
	const candidates = [",", "\t", ";"];
	let bestDelimiter: string | null = null;
	let bestCount = 0;

	for (const candidate of candidates) {
		const count = line.split(candidate).length - 1;
		if (count > bestCount) {
			bestCount = count;
			bestDelimiter = candidate;
		}
	}

	return bestCount > 0 ? bestDelimiter : null;
}

function parsePlainLine(line: string, fallbackRank: number): RadarDomainEntry | null {
	const trimmed = line.trim();
	if (trimmed.length === 0) {
		return null;
	}

	const numericPrefixMatch = trimmed.match(/^(\d+)\s+(.+)$/u);
	if (numericPrefixMatch?.[2]) {
		const domain = normalizeDomain(numericPrefixMatch[2]);
		if (domain) {
			return {
				rank: Number(numericPrefixMatch[1]),
				domain,
			};
		}
	}

	const domain = normalizeDomain(trimmed);
	if (!domain) {
		return null;
	}

	return {
		rank: fallbackRank,
		domain,
	};
}

function parseTextEntries(rawText: string): RadarDomainEntry[] {
	const cleaned = stripBom(rawText).trim();
	if (cleaned.length === 0) {
		throw new Error("Cloudflare Radar returned an empty attachment.");
	}

	if (looksLikeCloudflareChallenge(cleaned)) {
		throw new Error("Cloudflare Radar returned a challenge page instead of the domains attachment.");
	}

	const jsonEntries = parseJsonEntries(cleaned);
	if (jsonEntries) {
		return jsonEntries;
	}

	const lines = cleaned.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
	if (lines.length === 0) {
		throw new Error("Cloudflare Radar returned no attachment rows.");
	}

	const delimiter = detectDelimiter(lines[0] ?? "");
	if (!delimiter) {
		return dedupeEntries(
			lines
				.map((line, index) => parsePlainLine(line, index + 1))
				.filter((entry): entry is RadarDomainEntry => entry !== null),
		);
	}

	const firstRow = parseDelimitedLine(lines[0] ?? "", delimiter);
	const normalizedHeaders = firstRow.map(normalizeHeader);
	const headerDomainIndex = normalizedHeaders.findIndex(isDomainHeader);
	const headerRankIndex = normalizedHeaders.findIndex(isRankHeader);
	const hasHeader = headerDomainIndex >= 0 || headerRankIndex >= 0;
	const domainIndex = headerDomainIndex >= 0 ? headerDomainIndex : 1;
	const rankIndex = headerRankIndex >= 0 ? headerRankIndex : 0;
	const dataLines = hasHeader ? lines.slice(1) : lines;

	const entries = dataLines
		.map((line, index) => {
			const cells = parseDelimitedLine(line, delimiter);
			const domain = normalizeDomain(cells[domainIndex] ?? cells[1] ?? cells[0] ?? "");
			if (!domain) {
				return null;
			}

			return {
				rank: parseRankValue(cells[rankIndex], index + 1),
				domain,
			};
		})
		.filter((entry): entry is RadarDomainEntry => entry !== null);

	if (entries.length === 0) {
		throw new Error("Cloudflare Radar attachment format was not recognized.");
	}

	return dedupeEntries(entries);
}

function dedupeEntries(entries: readonly RadarDomainEntry[]): RadarDomainEntry[] {
	const unique = new Map<string, RadarDomainEntry>();

	for (const entry of entries) {
		const existing = unique.get(entry.domain);
		if (!existing) {
			unique.set(entry.domain, entry);
			continue;
		}

		if (existing.rank === null || (entry.rank !== null && entry.rank < existing.rank)) {
			unique.set(entry.domain, entry);
		}
	}

	return Array.from(unique.values()).sort((left, right) => {
		const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
		const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
		if (leftRank !== rightRank) {
			return leftRank - rightRank;
		}

		return left.domain.localeCompare(right.domain);
	});
}

function escapeRegex(value: string): string {
	return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

function createWildcardMatcher(pattern: string): RegExp {
	const normalizedPattern = pattern.trim();
	if (normalizedPattern.length === 0) {
		throw new InvalidParamsError("Param 'pattern' must not be empty.");
	}

	const source = escapeRegex(normalizedPattern)
		.replace(/\*/gu, ".*")
		.replace(/\?/gu, ".");

	return new RegExp(`^${source}$`, "iu");
}

function isBrowser(session: Browser | BrowserContext): session is Browser {
	return typeof (session as Browser).newContext === "function";
}

async function ensureCloakKit(context: ModuleExecutionContext): Promise<CloakKit> {
	let kit = context.getCloakKit();
	if (kit) {
		return kit;
	}

	kit = await context.runtime.attachKit(new CloakKit(), {
		reason: "module:cloudflare-radar-domains",
	});
	return kit;
}

function resolveProfileId(kit: CloakKit, requestedProfileId: string | undefined): string {
	if (requestedProfileId) {
		return requestedProfileId;
	}

	const profiles = kit.getProfiles();
	if (profiles.length === 1) {
		return profiles[0]?.id ?? "";
	}

	if (profiles.length === 0) {
		throw new InvalidParamsError(
			"Cloudflare Radar requires a browser-backed fetch here. Create a CloakBrowser profile with $.kits.cloak.manager() or pass cloakProfileId.",
		);
	}

	throw new InvalidParamsError(
		"Cloudflare Radar requires a browser-backed fetch here. Pass cloakProfileId to select one of the configured CloakBrowser profiles.",
	);
}

async function openCloakPage(context: ModuleExecutionContext, profileId: string): Promise<BrowserPageLease> {
	const kit = await ensureCloakKit(context);
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

async function waitForRadarReady(page: import("playwright-core").Page, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + Math.min(timeoutMs, 15000);

	while (Date.now() < deadline) {
		const title = await page.title().catch(() => "");
		if (!title.toLowerCase().includes("just a moment")) {
			return;
		}

		await page.waitForTimeout(500);
	}
}

async function fetchAttachmentWithBrowser(
	context: ModuleExecutionContext,
	attachmentUrl: string,
	timeoutMs: number,
	requestedProfileId: string | undefined,
): Promise<BrowserTextResponse> {
	const kit = await ensureCloakKit(context);
	const profileId = resolveProfileId(kit, requestedProfileId);
	const lease = await openCloakPage(context, profileId);

	try {
		await lease.page.goto(RADAR_HOME_URL, {
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});

		await waitForRadarReady(lease.page, timeoutMs);

		await lease.page.waitForLoadState("networkidle", {
			timeout: Math.min(timeoutMs, 5000),
		}).catch(() => {});

		return await lease.page.evaluate(async (url) => {
			const response = await fetch(url, {
				credentials: "include",
				headers: {
					accept: "text/csv,text/plain,application/json;q=0.9,*/*;q=0.8",
				},
			});
			const text = await response.text();
			return {
				contentType: response.headers.get("content-type") ?? undefined,
				status: response.status,
				text,
				url: response.url,
			};
		}, attachmentUrl);
	} finally {
		await lease.close().catch(() => {});
	}
}

async function fetchAttachmentWithHttp(attachmentUrl: string, timeoutMs: number): Promise<BrowserTextResponse> {
	const response = await $axios.get<string>(attachmentUrl, {
		responseType: "text",
		timeout: timeoutMs,
		headers: {
			Accept: "text/csv,text/plain,application/json;q=0.9,*/*;q=0.8",
		},
		validateStatus: () => true,
	});

	return {
		contentType: typeof response.headers["content-type"] === "string"
			? response.headers["content-type"]
			: undefined,
		status: response.status,
		text: typeof response.data === "string" ? response.data : JSON.stringify(response.data),
		url: response.request?.res?.responseUrl ?? attachmentUrl,
	};
}

function shouldUseBrowserFallback(response: BrowserTextResponse): boolean {
	return response.status === 403 || looksLikeCloudflareChallenge(response.text);
}

async function downloadRadarDomains(
	context: ModuleExecutionContext,
	params: CloudflareRadarDomainsPullParams,
): Promise<RadarDownloadResult> {
	const top = readTopValue(params);
	const dateEnd = readDateEnd(params.dateEnd);
	const timeoutMs = readTimeoutMs(params.timeoutMs);
	const fetchMode = readFetchMode(params.fetchMode);
	const cloakProfileId = readOptionalNonEmptyString(params.cloakProfileId, "cloakProfileId");
	const attachmentUrl = buildAttachmentUrl(top, dateEnd);

	let response: BrowserTextResponse;
	let actualFetchMode: Exclude<RadarFetchMode, "auto">;
	let usedBrowserFallback = false;

	if (fetchMode === "browser") {
		response = await fetchAttachmentWithBrowser(context, attachmentUrl, timeoutMs, cloakProfileId);
		actualFetchMode = "browser";
	} else {
		response = await fetchAttachmentWithHttp(attachmentUrl, timeoutMs);
		actualFetchMode = "http";

		if (fetchMode === "auto" && shouldUseBrowserFallback(response)) {
			response = await fetchAttachmentWithBrowser(context, attachmentUrl, timeoutMs, cloakProfileId);
			actualFetchMode = "browser";
			usedBrowserFallback = true;
		}
	}

	if (response.status >= 400 && !looksLikeCloudflareChallenge(response.text)) {
		throw new Error(`Cloudflare Radar request failed with HTTP ${response.status}.`);
	}

	const entries = parseTextEntries(response.text);
	return {
		entries,
		dateEnd,
		top,
		sourceUrl: attachmentUrl,
		fetchMode: actualFetchMode,
		contentType: response.contentType,
		fetchedAt: new Date().toISOString(),
		usedBrowserFallback,
	};
}

function createSummaryEntity(result: RadarDownloadResult): OutputEntity {
	return createTextEntity(
		[
			"Cloudflare Radar top domains",
			`Date end: ${result.dateEnd}`,
			`Requested top: ${result.top}`,
			`Rows: ${result.entries.length}`,
			`Fetch mode: ${result.fetchMode}${result.usedBrowserFallback ? " (auto fallback)" : ""}`,
			`Fetched at: ${result.fetchedAt}`,
			`Content type: ${result.contentType ?? "unknown"}`,
			`Source: ${result.sourceUrl}`,
		],
		{ tone: "info" },
	);
}

async function savePullArtifacts(result: RadarDownloadResult): Promise<RadarSavedArtifacts> {
	const directoryPath = path.join(RADAR_OUTPUT_ROOT, result.dateEnd);
	const baseFileName = `top-${result.top}-${formatFileTimestamp(result.fetchedAt)}`;
	const jsonPath = path.join(directoryPath, `${baseFileName}.json`);
	const textPath = path.join(directoryPath, `${baseFileName}.txt`);
	const jsonPayload = JSON.stringify({
		dateEnd: result.dateEnd,
		top: result.top,
		fetchedAt: result.fetchedAt,
		fetchMode: result.fetchMode,
		contentType: result.contentType,
		usedBrowserFallback: result.usedBrowserFallback,
		sourceUrl: result.sourceUrl,
		entries: result.entries,
	}, null, 2);
	const textPayload = `${result.entries
		.map(entry => entry.rank === null ? entry.domain : `${entry.rank}\t${entry.domain}`)
		.join("\n")}\n`;

	await fs.mkdir(directoryPath, { recursive: true });
	await Promise.all([
		fs.writeFile(jsonPath, jsonPayload, "utf8"),
		fs.writeFile(textPath, textPayload, "utf8"),
	]);

	return {
		directoryPath,
		jsonPath,
		textPath,
	};
}

function createSavedArtifactsEntity(artifacts: RadarSavedArtifacts): OutputEntity {
	return createTextEntity(
		[
			"Saved Cloudflare Radar pull",
			`Directory: ${toProjectPath(artifacts.directoryPath)}`,
			`JSON: ${toProjectPath(artifacts.jsonPath)}`,
			`Text: ${toProjectPath(artifacts.textPath)}`,
		],
		{ tone: "info" },
	);
}

function createEntriesTable(title: string, entries: readonly RadarDomainEntry[]): OutputEntity {
	if (entries.length === 0) {
		return createTextEntity("No domains returned.", { tone: "muted" });
	}

	return createTableEntity(
		[
			{ key: "rank", header: "Rank", maxWidth: 8, align: "right" },
			{ key: "domain", header: "Domain", maxWidth: 96 },
		],
		entries.map(entry => ({
			rank: entry.rank ?? "",
			domain: entry.domain,
		})),
		{ title },
	);
}

const pullExecutor = defineExecutor<CloudflareRadarDomainsPullParams>(async (context) => {
	const result = await downloadRadarDomains(context, context.params);
	const savedArtifacts = await savePullArtifacts(result);
	return [
		createSummaryEntity(result),
		createSavedArtifactsEntity(savedArtifacts),
		createEntriesTable("Radar domains", result.entries),
	];
});

const searchExecutor = defineExecutor<CloudflareRadarDomainsSearchParams>(async (context) => {
	const pattern = readSearchPattern(context.params);
	const result = await downloadRadarDomains(context, context.params);
	const matcher = createWildcardMatcher(pattern);
	const matches = result.entries.filter(entry => matcher.test(entry.domain));

	return [
		createSummaryEntity(result),
		createTextEntity(
			`Pattern: ${pattern}\nMatches: ${matches.length}`,
			{ tone: matches.length > 0 ? "info" : "muted" },
		),
		matches.length > 0
			? createEntriesTable("Matching radar domains", matches)
			: createTextEntity("No domains matched the requested wildcard pattern.", { tone: "muted" }),
	];
});

function definePullModule(id: string, description: string) {
	return defineModule({
		id,
		aliases: id === "cloudflare/radar/domains/pull" ? ["clouflare/radar/domains/pull"] : undefined,
		category: "discovery",
		description,
		notebookTypeOverlay: DISCOVERY_NOTEBOOK_TYPE_OVERLAY,
		consoleParams: RADAR_PULL_CONSOLE_PARAMS,
		executor: pullExecutor,
	}).useDefault("top");
}

function defineSearchModule(id: string, description: string) {
	return defineModule({
		id,
		aliases: id === "cloudflare/radar/domains/search" ? ["clouflare/radar/domains/search"] : undefined,
		category: "discovery",
		description,
		notebookTypeOverlay: DISCOVERY_NOTEBOOK_TYPE_OVERLAY,
		consoleParams: RADAR_SEARCH_CONSOLE_PARAMS,
		executor: searchExecutor,
	}).useDefault("pattern");
}

export const cloudflareRadarDomainsPullModule = definePullModule(
	"cloudflare/radar/domains/pull",
	"Download the Cloudflare Radar top domains attachment for dateEnd=today by default and save each pull under data/cloudflare-radar/domains",
);

export const cloudflareRadarDomainsSearchModule = defineSearchModule(
	"cloudflare/radar/domains/search",
	"Fetch Cloudflare Radar top domains and filter them with a wildcard pattern",
);