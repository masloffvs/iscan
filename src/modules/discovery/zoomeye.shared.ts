import type { Browser, BrowserContext, Page, Response as PlaywrightResponse } from "playwright-core";

import { logger as sharedLogger } from "../../logger";
import {
	$storageKit,
	CloakKit,
	type CloakProfile,
	type PersistedZoomEyeHostRecord,
	type PersistedZoomEyeQueryHistoryRecord,
	type StorageKit,
	type ZoomEyeHostSelectRow,
	type ZoomEyeQueryHistoryKind,
	type ZoomEyeQueryHistoryRow,
} from "../../kits";
import { InvalidParamsError } from "../errors";
import { defineNotebookTypeOverlay, type ModuleConsoleParam, type ModuleExecutionContext } from "../module";

const ZOOMEYE_SEARCH_RESULT_URL = "https://www.zoomeye.ai/searchResult";
const ZOOMEYE_SEARCH_API_URL = "https://www.zoomeye.ai/api/search";
export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_MAX_RESULTS = 250;
export const DEFAULT_START_PAGE = 1;
export const DEFAULT_SEARCH_TYPE = "v4+v6+web";
export const DEFAULT_SELECT_SCAN_LIMIT = 10_000;
export const DEFAULT_HISTORY_LIMIT = 100;
export const DEFAULT_PASSIVE_CAPTURE_EVENT_LIMIT = 24;
export const ZOOMEYE_SEARCH_TYPE_OPTIONS = ["v4+v6+web", "web", "v4", "v6"] as const;
export const ZOOMEYE_NOTEBOOK_TYPE_OVERLAY = defineNotebookTypeOverlay("src/modules/discovery/zoomeye.h.ts");

const SEARCH_RESPONSE_TIMEOUT_MS = 30_000;
const AUTH_READY_SELECTOR = 'a.header-user-info[href="/profile"]';

export type ZoomEyePullParams = {
	queryBase64?: string;
	query?: string;
	startPage?: number;
	pageSize?: number;
	maxResults?: number;
	searchType?: string;
	authTimeoutMs?: number;
	expectedUserText?: string;
	cloakProfileId?: string;
};

export type ZoomEyePassiveCaptureParams = {
	cloakProfileId?: string;
};

type ZoomEyeSearchResponse = {
	status?: number;
	matches?: ZoomEyeMatch[];
};

export type ZoomEyeMatch = {
	ip?: string;
	body?: string;
	banner?: string;
	header?: string;
	token?: string;
	qid?: string;
	timestamp?: string;
	type?: string;
	os?: string;
	portinfo?: {
		product?: string;
		hostname?: string;
		os?: string;
		port?: number;
		service?: string;
		transport?: string;
		title?: string | null;
		extrainfo?: string;
	};
	geoinfo?: {
		organization?: string;
		asn?: string;
		country?: {
			code?: string;
			names?: {
				en?: string;
				cn?: string;
			};
		};
		city?: {
			names?: {
				en?: string;
				cn?: string;
			};
		};
		subdivisions?: {
			names?: {
				en?: string;
				cn?: string;
			};
		};
	};
};

type BrowserNetworkPayload = {
	status: number;
	text: string;
	url: string;
	method: string;
	resourceType: string;
};

type ZoomEyeSearchRequestInfo = {
	queryBase64: string;
	queryText: string | null;
	page: number;
	pageSize: number;
	searchType: string;
};

type ZoomEyeRuntime = Pick<ModuleExecutionContext<unknown, object>["runtime"], "attachKit" | "getCloakKit" | "getStorageKit">;
type ZoomEyeLogger = Pick<typeof sharedLogger, "info">;

export type ZoomEyePullExecutionResult = {
	queryBase64: string;
	queryText: string | null;
	searchType: string;
	startPage: number;
	pageSize: number;
	maxResults: number;
	authTimeoutMs: number;
	expectedUserText?: string;
	requestedCloakProfileId?: string;
	authenticatedUser: string;
	cloakProfile: CloakProfile;
	cloakProfileLabel: string;
	fetchedAt: string;
	pagesFetched: number;
	rawMatches: number;
	uniqueMatches: number;
	inserted: number;
	updated: number;
	previewMatches: ZoomEyeMatch[];
};

export type ZoomEyePassiveCaptureEvent = {
	capturedAt: string;
	errorMessage: string | null;
	pageId: string | null;
	pageUrl: string | null;
	requestUrl: string;
	method: string;
	resourceType: string;
	status: number;
	queryBase64: string;
	queryText: string | null;
	searchType: string;
	page: number;
	pageSize: number;
	rawMatches: number;
	uniqueMatches: number;
	inserted: number;
	updated: number;
};

export type ZoomEyePassiveCaptureSession = {
	captureId: string;
	active: boolean;
	profileRunning: boolean;
	cloakProfileId: string;
	cloakProfileLabel: string;
	startedAt: string;
	lastCapturedAt: string | null;
	currentUrl: string | null;
	totalCaptured: number;
	recentEvents: ZoomEyePassiveCaptureEvent[];
};

export type ZoomEyeSelectParams = {
	pattern?: string;
	query?: string;
	field?: string;
	limit?: number;
};

export const ZOOMEYE_SEARCHABLE_FIELDS = [
	"ip",
	"hostname",
	"service",
	"transport",
	"product",
	"os",
	"title",
	"body",
	"header",
	"banner",
	"organization",
	"country_code",
	"country_name_en",
	"query_text",
] as const;

export type ZoomEyeSearchableField = typeof ZOOMEYE_SEARCHABLE_FIELDS[number];

export type ZoomEyeSelectExecutionResult = {
	pattern: string;
	field: ZoomEyeSearchableField | null;
	scanLimit: number;
	scannedRows: number;
	matches: ZoomEyeHostSelectRow[];
};

type BrowserPageLease = {
	page: Page;
	close(): Promise<void>;
};

type ZoomEyePassiveCaptureSessionState = {
	captureId: string;
	cloakProfile: CloakProfile;
	cloakProfileLabel: string;
	startedAt: string;
	lastCapturedAt: string | null;
	totalCaptured: number;
	recentEvents: ZoomEyePassiveCaptureEvent[];
	handle: {
		stop: () => Promise<void>;
	};
};

const zoomEyePassiveCaptureSessions = new Map<string, ZoomEyePassiveCaptureSessionState>();

export const ZOOMEYE_PULL_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "queryBase64",
		detail: "Base64-encoded ZoomEye search query used as q=.",
		valueType: "string",
		example: "queryBase64=YXBwPSJPbGxhbWEi",
		required: true,
	},
	{
		name: "query",
		detail: "Plain ZoomEye query string. It will be base64-encoded automatically if queryBase64 is omitted.",
		valueType: "string",
		example: 'query=app="Ollama"',
	},
	{
		name: "startPage",
		detail: "First search page to fetch.",
		valueType: "number",
		example: "startPage=1",
	},
	{
		name: "pageSize",
		detail: `Results per page. Default is ${DEFAULT_PAGE_SIZE}.`,
		valueType: "number",
		example: `pageSize=${DEFAULT_PAGE_SIZE}`,
	},
	{
		name: "maxResults",
		detail: `Maximum raw results to collect across pages. Default is ${DEFAULT_MAX_RESULTS}.`,
		valueType: "number",
		example: `maxResults=${DEFAULT_MAX_RESULTS}`,
	},
	{
		name: "searchType",
		detail: "ZoomEye search scope passed as t=.",
		valueType: "string",
		values: [...ZOOMEYE_SEARCH_TYPE_OPTIONS],
		example: `searchType=${DEFAULT_SEARCH_TYPE}`,
	},
	{
		name: "authTimeoutMs",
		detail: "How long to wait for manual authentication. 0 waits indefinitely.",
		valueType: "number",
		example: "authTimeoutMs=0",
	},
	{
		name: "expectedUserText",
		detail: "Optional text that must appear inside the authenticated user badge.",
		valueType: "string",
		example: "expectedUserText=masloff.kz@gmail.com",
	},
	{
		name: "cloakProfileId",
		detail: "CloakBrowser profile id or unique name to reuse for the authenticated ZoomEye session.",
		valueType: "string",
		example: "cloakProfileId=cf",
	},
];

export const ZOOMEYE_SELECT_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "pattern",
		detail: "Regex pattern to match against the selected field(s).",
		valueType: "string",
		example: 'pattern=Ollama',
		required: true,
	},
	{
		name: "query",
		detail: "Alias for pattern.",
		valueType: "string",
		example: "query=nginx",
	},
	{
		name: "field",
		detail: `Column to search in. Defaults to all text fields. One of: ${ZOOMEYE_SEARCHABLE_FIELDS.join(", ")}.`,
		valueType: "string",
		values: [...ZOOMEYE_SEARCHABLE_FIELDS],
		example: "field=product",
	},
	{
		name: "limit",
		detail: `Max rows to scan from the database. Default is ${DEFAULT_SELECT_SCAN_LIMIT}.`,
		valueType: "number",
		example: `limit=${DEFAULT_SELECT_SCAN_LIMIT}`,
	},
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

function readOptionalNonNegativeInteger(value: unknown, paramName: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new InvalidParamsError(`Param '${paramName}' must be a non-negative integer.`);
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

export function encodeQueryBase64(query: string): string {
	return Buffer.from(query, "utf8").toString("base64");
}

export function decodeQueryBase64(queryBase64: string): string | null {
	try {
		const decoded = Buffer.from(queryBase64, "base64").toString("utf8");
		return decoded.length > 0 ? decoded : null;
	} catch {
		return null;
	}
}

export function readQueryBase64(params: ZoomEyePullParams): { queryBase64: string; queryText: string | null } {
	const queryBase64 = readOptionalString(params.queryBase64, "queryBase64");
	if (queryBase64) {
		return {
			queryBase64,
			queryText: decodeQueryBase64(queryBase64),
		};
	}

	const queryText = readOptionalString(params.query, "query");
	if (queryText) {
		return {
			queryBase64: encodeQueryBase64(queryText),
			queryText,
		};
	}

	throw new InvalidParamsError("Param 'queryBase64' or 'query' is required.");
}

function buildSearchResultUrl(queryBase64: string, page: number, pageSize: number, searchType: string): string {
	const searchParams = new URLSearchParams({
		q: queryBase64,
		page: String(page),
		pageSize: String(pageSize),
		t: searchType,
	});

	return `${ZOOMEYE_SEARCH_RESULT_URL}?${searchParams.toString()}`;
}

function buildApiUrl(queryBase64: string, page: number, pageSize: number, searchType: string): string {
	const searchParams = new URLSearchParams({
		q: queryBase64,
		page: String(page),
		pageSize: String(pageSize),
		t: searchType,
	});

	return `${ZOOMEYE_SEARCH_API_URL}?${searchParams.toString()}`;
}

function parseSearchRequestInfo(requestUrl: string): ZoomEyeSearchRequestInfo | null {
	if (!requestUrl.startsWith(ZOOMEYE_SEARCH_API_URL)) {
		return null;
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(requestUrl);
	} catch {
		return null;
	}

	const queryBase64 = parsedUrl.searchParams.get("q")?.trim() ?? "";
	const page = Number.parseInt(parsedUrl.searchParams.get("page") ?? "", 10);
	const pageSize = Number.parseInt(parsedUrl.searchParams.get("pageSize") ?? "", 10);
	const searchType = parsedUrl.searchParams.get("t")?.trim() ?? DEFAULT_SEARCH_TYPE;
	if (queryBase64.length === 0 || !Number.isInteger(page) || page <= 0 || !Number.isInteger(pageSize) || pageSize <= 0) {
		return null;
	}

	return {
		queryBase64,
		queryText: decodeQueryBase64(queryBase64),
		page,
		pageSize,
		searchType,
	};
}

function isZoomEyeSearchResponseCandidate(response: PlaywrightResponse): boolean {
	const requestInfo = parseSearchRequestInfo(response.url());
	if (!requestInfo) {
		return false;
	}

	const resourceType = response.request().resourceType();
	return resourceType === "xhr" || resourceType === "fetch";
}

async function waitForAuthenticatedUser(page: Page, expectedUserText: string | undefined, authTimeoutMs: number): Promise<string> {
	const profileLink = page.locator(AUTH_READY_SELECTOR).first();
	await profileLink.waitFor({ state: "visible", timeout: authTimeoutMs });
	const text = (await profileLink.innerText()).trim();

	if (expectedUserText && !text.includes(expectedUserText)) {
		throw new Error(`ZoomEye user badge was found, but it did not include '${expectedUserText}'. Actual text: ${text}`);
	}

	return text;
}

function isMatchingSearchResponse(
	response: PlaywrightResponse,
	options: {
		queryBase64: string;
		page: number;
		pageSize: number;
		searchType: string;
	},
): boolean {
	const responseUrl = response.url();
	if (!responseUrl.startsWith(ZOOMEYE_SEARCH_API_URL)) {
		return false;
	}

	const request = response.request();
	const resourceType = request.resourceType();
	if (resourceType !== "xhr" && resourceType !== "fetch") {
		return false;
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(responseUrl);
	} catch {
		return false;
	}

	const params = parsedUrl.searchParams;
	return (
		params.get("q") === options.queryBase64
		&& params.get("page") === String(options.page)
		&& params.get("pageSize") === String(options.pageSize)
		&& params.get("t") === options.searchType
	);
}

async function fetchSearchPageFromBrowser(
	page: Page,
	options: {
		queryBase64: string;
		pageNumber: number;
		pageSize: number;
		searchType: string;
	},
): Promise<BrowserNetworkPayload> {
	const responsePromise = page.waitForResponse(
		(response) => isMatchingSearchResponse(response, {
			queryBase64: options.queryBase64,
			page: options.pageNumber,
			pageSize: options.pageSize,
			searchType: options.searchType,
		}),
		{ timeout: SEARCH_RESPONSE_TIMEOUT_MS },
	);

	const searchUrl = buildSearchResultUrl(
		options.queryBase64,
		options.pageNumber,
		options.pageSize,
		options.searchType,
	);
	await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

	const response = await responsePromise;
	return {
		status: response.status(),
		text: await response.text(),
		url: response.url(),
		method: response.request().method(),
		resourceType: response.request().resourceType(),
	};
}

function parseSearchResponse(payload: BrowserNetworkPayload, apiUrl: string): ZoomEyeSearchResponse {
	if (payload.status >= 400) {
		throw new Error(`ZoomEye browser request failed with HTTP ${payload.status}: ${payload.url || apiUrl}`);
	}

	let parsed: ZoomEyeSearchResponse;
	try {
		parsed = JSON.parse(payload.text) as ZoomEyeSearchResponse;
	} catch (error) {
		throw new Error(`ZoomEye browser response returned invalid JSON for ${payload.url || apiUrl}`, { cause: error });
	}

	if (parsed.status !== 200 || !Array.isArray(parsed.matches)) {
		throw new Error(`ZoomEye browser response returned an unexpected payload for ${payload.url || apiUrl}`);
	}

	return parsed;
}

export function normalizeMatchPort(match: ZoomEyeMatch): number | null {
	const port = match.portinfo?.port;
	return typeof port === "number" && Number.isInteger(port) && port > 0 ? port : null;
}

function createUniqueMatchMap(matches: readonly ZoomEyeMatch[]): Map<string, ZoomEyeMatch> {
	const unique = new Map<string, ZoomEyeMatch>();

	for (const match of matches) {
		if (typeof match.ip !== "string" || match.ip.trim().length === 0) {
			continue;
		}

		const port = normalizeMatchPort(match);
		if (port === null) {
			continue;
		}

		const key = `${match.ip.trim()}:${port}`;
		if (!unique.has(key)) {
			unique.set(key, match);
		}
	}

	return unique;
}

function toPersistedRecords(
	matches: readonly ZoomEyeMatch[],
	options: {
		queryBase64: string;
		queryText: string | null;
		searchType: string;
		pageSize: number;
		fetchedAt: string;
	},
): PersistedZoomEyeHostRecord[] {
	const uniqueMatches = createUniqueMatchMap(matches);

	return Array.from(uniqueMatches.values()).map((match) => ({
		ip: match.ip?.trim() ?? "",
		port: normalizeMatchPort(match) ?? 0,
		queryBase64: options.queryBase64,
		queryText: options.queryText,
		searchType: options.searchType,
		pageSize: options.pageSize,
		fetchedAt: options.fetchedAt,
		type: match.type ?? null,
		service: match.portinfo?.service ?? null,
		transport: match.portinfo?.transport ?? null,
		product: match.portinfo?.product ?? null,
		hostname: match.portinfo?.hostname ?? null,
		os: match.portinfo?.os ?? match.os ?? null,
		title: typeof match.portinfo?.title === "string" ? match.portinfo.title : null,
		extraInfo: match.portinfo?.extrainfo ?? null,
		body: match.body ?? null,
		header: match.header ?? null,
		banner: match.banner ?? null,
		token: match.token ?? null,
		qid: match.qid ?? null,
		zoomeyeTimestamp: match.timestamp ?? null,
		countryCode: match.geoinfo?.country?.code ?? null,
		countryNameEn: match.geoinfo?.country?.names?.en ?? null,
		countryNameCn: match.geoinfo?.country?.names?.cn ?? null,
		cityNameEn: match.geoinfo?.city?.names?.en ?? null,
		cityNameCn: match.geoinfo?.city?.names?.cn ?? null,
		subdivisionNameEn: match.geoinfo?.subdivisions?.names?.en ?? null,
		subdivisionNameCn: match.geoinfo?.subdivisions?.names?.cn ?? null,
		organization: match.geoinfo?.organization ?? null,
		asn: match.geoinfo?.asn ?? null,
		rawJson: JSON.stringify(match),
	}));
}

function isBrowser(session: Browser | BrowserContext): session is Browser {
	return typeof (session as Browser).newContext === "function";
}

function ensureStorageKit(storageKit: StorageKit | null): StorageKit {
	if (storageKit) {
		return storageKit;
	}

	return $storageKit;
}

async function ensureStorageKitAttached(runtime: ZoomEyeRuntime, reason: string): Promise<StorageKit> {
	const storageKit = runtime.getStorageKit();
	if (storageKit) {
		return storageKit;
	}

	return runtime.attachKit(ensureStorageKit(storageKit), { reason });
}

async function ensureZoomEyeCloakKit(runtime: ZoomEyeRuntime): Promise<CloakKit> {
	const cloakKit = runtime.getCloakKit();
	if (cloakKit) {
		return cloakKit;
	}

	return runtime.attachKit(new CloakKit(), {
		reason: "module:discovery/zoomeye/pull",
	});
}

function resolveCloakProfileOrThrow(kit: CloakKit, target: string): CloakProfile {
	const normalizedTarget = target.trim();
	if (normalizedTarget.length === 0) {
		throw new InvalidParamsError("Param 'cloakProfileId' must be a non-empty string.");
	}

	const profiles = kit.getProfiles();
	const byId = profiles.find((profile) => profile.id === normalizedTarget);
	if (byId) {
		return byId;
	}

	const byName = profiles.filter((profile) => profile.name === normalizedTarget);
	if (byName.length === 1) {
		return byName[0] ?? null as never;
	}

	if (byName.length > 1) {
		throw new InvalidParamsError(`Cloak profile target is ambiguous: ${normalizedTarget}`);
	}

	throw new InvalidParamsError(`Cloak profile '${normalizedTarget}' not found.`);
}

export function resolveZoomEyeCloakProfile(kit: CloakKit, requestedProfileId: string | undefined): CloakProfile {
	if (requestedProfileId) {
		return resolveCloakProfileOrThrow(kit, requestedProfileId);
	}

	const profiles = kit.getProfiles();
	if (profiles.length === 1) {
		return profiles[0] ?? null as never;
	}

	if (profiles.length === 0) {
		throw new InvalidParamsError(
			"ZoomEye requires a CloakBrowser profile. Create one with $.kits.cloak.manager() or pass cloakProfileId.",
		);
	}

	throw new InvalidParamsError(
		"ZoomEye requires cloakProfileId to select one of the configured CloakBrowser profiles.",
	);
}

function ensureHeadfulProfile(profile: CloakProfile): void {
	if (profile.headless === true) {
		throw new InvalidParamsError(
			`Cloak profile '${profile.name}' is configured as headless. Set headless=false in kits/cloak/manager before using ZoomEye login flow.`,
		);
	}
}

async function openCloakPage(runtime: ZoomEyeRuntime, profile: CloakProfile): Promise<BrowserPageLease> {
	const kit = await ensureZoomEyeCloakKit(runtime);
	const launchedSession = await kit.launchProfile(profile.id, {
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

function buildHistoryRecord(record: PersistedZoomEyeQueryHistoryRecord): PersistedZoomEyeQueryHistoryRecord {
	return record;
}

function buildPullHistoryRecord(options: {
	queryBase64: string;
	queryText: string | null;
	searchType: string;
	pageSize: number;
	maxResults: number;
	startPage: number;
	cloakProfileTarget: string | null;
	resultCount: number;
	usedAt: string;
}): PersistedZoomEyeQueryHistoryRecord {
	return buildHistoryRecord({
		dedupeKey: `pull|${options.queryBase64}`,
		kind: "pull",
		label: options.queryText ?? options.queryBase64,
		queryText: options.queryText,
		queryBase64: options.queryBase64,
		searchField: null,
		searchType: options.searchType,
		pageSize: options.pageSize,
		maxResults: options.maxResults,
		startPage: options.startPage,
		limitRows: null,
		cloakProfileTarget: options.cloakProfileTarget,
		resultCount: options.resultCount,
		usedAt: options.usedAt,
	});
}

function buildSearchHistoryRecord(options: {
	pattern: string;
	field: ZoomEyeSearchableField | null;
	limit: number;
	resultCount: number;
	usedAt: string;
}): PersistedZoomEyeQueryHistoryRecord {
	return buildHistoryRecord({
		dedupeKey: `search|${options.pattern}|${options.field ?? "*"}`,
		kind: "search",
		label: options.pattern,
		queryText: options.pattern,
		queryBase64: null,
		searchField: options.field,
		searchType: null,
		pageSize: null,
		maxResults: null,
		startPage: null,
		limitRows: options.limit,
		cloakProfileTarget: null,
		resultCount: options.resultCount,
		usedAt: options.usedAt,
	});
}

function buildCaptureHistoryRecord(options: {
	queryBase64: string;
	queryText: string | null;
	searchType: string;
	page: number;
	pageSize: number;
	cloakProfileTarget: string;
	resultCount: number;
	usedAt: string;
}): PersistedZoomEyeQueryHistoryRecord {
	return buildHistoryRecord({
		dedupeKey: `capture|${options.queryBase64}|${options.searchType}|${options.pageSize}`,
		kind: "capture",
		label: options.queryText ?? options.queryBase64,
		queryText: options.queryText,
		queryBase64: options.queryBase64,
		searchField: null,
		searchType: options.searchType,
		pageSize: options.pageSize,
		maxResults: null,
		startPage: options.page,
		limitRows: null,
		cloakProfileTarget: options.cloakProfileTarget,
		resultCount: options.resultCount,
		usedAt: options.usedAt,
	});
}

function buildPassiveCaptureSessionSnapshot(
	cloakKit: CloakKit,
	state: ZoomEyePassiveCaptureSessionState,
	active: boolean,
): ZoomEyePassiveCaptureSession {
	return {
		captureId: state.captureId,
		active,
		profileRunning: cloakKit.isProfileRunning(state.cloakProfile.id),
		cloakProfileId: state.cloakProfile.id,
		cloakProfileLabel: state.cloakProfileLabel,
		startedAt: state.startedAt,
		lastCapturedAt: state.lastCapturedAt,
		currentUrl: cloakKit.getProfileCurrentUrl(state.cloakProfile.id),
		totalCaptured: state.totalCaptured,
		recentEvents: [...state.recentEvents],
	};
}

async function stopPassiveCaptureSession(
	runtime: ZoomEyeRuntime,
	profileId: string,
): Promise<ZoomEyePassiveCaptureSession | null> {
	const state = zoomEyePassiveCaptureSessions.get(profileId);
	if (!state) {
		return null;
	}

	zoomEyePassiveCaptureSessions.delete(profileId);
	await state.handle.stop();
	const cloakKit = await ensureZoomEyeCloakKit(runtime);
	return buildPassiveCaptureSessionSnapshot(cloakKit, state, false);
}

function ingestPassiveCaptureEvent(
	storageKit: StorageKit,
	cloakProfileTarget: string,
	payload: {
		capturedAt: string;
		pageId: string | null;
		pageUrl: string | null;
		requestUrl: string;
		method: string;
		resourceType: string;
		status: number;
		text: string | null;
	},
): ZoomEyePassiveCaptureEvent | null {
	const requestInfo = parseSearchRequestInfo(payload.requestUrl);
	if (!requestInfo) {
		return null;
	}

	let errorMessage: string | null = null;
	let rawMatches = 0;
	let uniqueMatches = 0;
	let inserted = 0;
	let updated = 0;

	if (payload.text === null) {
		errorMessage = `ZoomEye browser response body was unavailable for ${payload.requestUrl}`;
	} else {
		try {
			const parsed = parseSearchResponse({
				status: payload.status,
				text: payload.text,
				url: payload.requestUrl,
				method: payload.method,
				resourceType: payload.resourceType,
			}, payload.requestUrl);
			const matches = parsed.matches ?? [];
			rawMatches = matches.length;

			const persistedRecords = toPersistedRecords(matches, {
				queryBase64: requestInfo.queryBase64,
				queryText: requestInfo.queryText,
				searchType: requestInfo.searchType,
				pageSize: requestInfo.pageSize,
				fetchedAt: payload.capturedAt,
			});
			uniqueMatches = persistedRecords.length;

			const summary = storageKit.upsertZoomEyeHosts(persistedRecords);
			inserted = summary.inserted;
			updated = summary.updated;

			storageKit.upsertZoomEyeQueryHistory(buildCaptureHistoryRecord({
				queryBase64: requestInfo.queryBase64,
				queryText: requestInfo.queryText,
				searchType: requestInfo.searchType,
				page: requestInfo.page,
				pageSize: requestInfo.pageSize,
				cloakProfileTarget,
				resultCount: uniqueMatches,
				usedAt: payload.capturedAt,
			}));
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	return {
		capturedAt: payload.capturedAt,
		errorMessage,
		pageId: payload.pageId,
		pageUrl: payload.pageUrl,
		requestUrl: payload.requestUrl,
		method: payload.method,
		resourceType: payload.resourceType,
		status: payload.status,
		queryBase64: requestInfo.queryBase64,
		queryText: requestInfo.queryText,
		searchType: requestInfo.searchType,
		page: requestInfo.page,
		pageSize: requestInfo.pageSize,
		rawMatches,
		uniqueMatches,
		inserted,
		updated,
	};
}

export async function listZoomEyeCloakProfiles(runtime: ZoomEyeRuntime): Promise<CloakProfile[]> {
	const cloakKit = await ensureZoomEyeCloakKit(runtime);
	return cloakKit.getProfiles();
}

export async function startZoomEyePassiveCapture(
	runtime: ZoomEyeRuntime,
	captureLogger: ZoomEyeLogger,
	params: ZoomEyePassiveCaptureParams,
): Promise<ZoomEyePassiveCaptureSession> {
	const requestedCloakProfileId = readOptionalString(params.cloakProfileId, "cloakProfileId");
	const cloakKit = await ensureZoomEyeCloakKit(runtime);
	const storageKit = await ensureStorageKitAttached(runtime, "module:discovery/zoomeye/capture");
	const cloakProfile = resolveZoomEyeCloakProfile(cloakKit, requestedCloakProfileId);
	ensureHeadfulProfile(cloakProfile);
	const cloakProfileLabel = `${cloakProfile.name} (${cloakProfile.id})`;

	if (!cloakKit.isProfileRunning(cloakProfile.id)) {
		await cloakKit.launchProfile(cloakProfile.id, {
			headless: false,
			trackSession: true,
		});
	}

	await stopPassiveCaptureSession(runtime, cloakProfile.id);

	const state: ZoomEyePassiveCaptureSessionState = {
		captureId: crypto.randomUUID(),
		cloakProfile,
		cloakProfileLabel,
		startedAt: new Date().toISOString(),
		lastCapturedAt: null,
		totalCaptured: 0,
		recentEvents: [],
		handle: {
			stop: async () => {},
		},
	};

	state.handle = await cloakKit.startProfileNetworkCapture(cloakProfile.id, {
		includeBodyText: true,
		shouldCaptureResponse: (response) => isZoomEyeSearchResponseCandidate(response),
		onResponse: async (payload) => {
			const event = ingestPassiveCaptureEvent(storageKit, cloakProfile.id, payload);
			if (!event) {
				return;
			}

			state.totalCaptured += 1;
			state.lastCapturedAt = event.capturedAt;
			state.recentEvents = [event, ...state.recentEvents].slice(0, DEFAULT_PASSIVE_CAPTURE_EVENT_LIMIT);
			captureLogger.info({
				captureId: state.captureId,
				cloakProfileId: cloakProfile.id,
				queryBase64: event.queryBase64,
				page: event.page,
				pageSize: event.pageSize,
				inserted: event.inserted,
				updated: event.updated,
				errorMessage: event.errorMessage,
			}, "Captured passive ZoomEye browser response.");
		},
	});

	zoomEyePassiveCaptureSessions.set(cloakProfile.id, state);
	return buildPassiveCaptureSessionSnapshot(cloakKit, state, true);
}

export async function getZoomEyePassiveCaptureSession(
	runtime: ZoomEyeRuntime,
	params: ZoomEyePassiveCaptureParams,
): Promise<ZoomEyePassiveCaptureSession | null> {
	const requestedCloakProfileId = readOptionalString(params.cloakProfileId, "cloakProfileId");
	const cloakKit = await ensureZoomEyeCloakKit(runtime);
	const cloakProfile = resolveZoomEyeCloakProfile(cloakKit, requestedCloakProfileId);
	const state = zoomEyePassiveCaptureSessions.get(cloakProfile.id);
	if (!state) {
		return null;
	}

	return buildPassiveCaptureSessionSnapshot(cloakKit, state, true);
}

export async function stopZoomEyePassiveCapture(
	runtime: ZoomEyeRuntime,
	params: ZoomEyePassiveCaptureParams,
): Promise<ZoomEyePassiveCaptureSession | null> {
	const requestedCloakProfileId = readOptionalString(params.cloakProfileId, "cloakProfileId");
	const cloakKit = await ensureZoomEyeCloakKit(runtime);
	const cloakProfile = resolveZoomEyeCloakProfile(cloakKit, requestedCloakProfileId);
	return stopPassiveCaptureSession(runtime, cloakProfile.id);
}

export async function executeZoomEyePull(
	runtime: ZoomEyeRuntime,
	pullLogger: ZoomEyeLogger,
	params: ZoomEyePullParams,
): Promise<ZoomEyePullExecutionResult> {
	const { queryBase64, queryText } = readQueryBase64(params);
	const startPage = readOptionalPositiveInteger(params.startPage, "startPage") ?? DEFAULT_START_PAGE;
	const pageSize = readOptionalPositiveInteger(params.pageSize, "pageSize") ?? DEFAULT_PAGE_SIZE;
	const maxResults = readOptionalPositiveInteger(params.maxResults, "maxResults") ?? DEFAULT_MAX_RESULTS;
	const searchType = readOptionalString(params.searchType, "searchType") ?? DEFAULT_SEARCH_TYPE;
	const authTimeoutMs = readOptionalNonNegativeInteger(params.authTimeoutMs, "authTimeoutMs") ?? 0;
	const expectedUserText = readOptionalString(params.expectedUserText, "expectedUserText");
	const requestedCloakProfileId = readOptionalString(params.cloakProfileId, "cloakProfileId");
	const fetchedAt = new Date().toISOString();
	const totalPagesToFetch = Math.max(1, Math.ceil(maxResults / pageSize));
	const cloakKit = await ensureZoomEyeCloakKit(runtime);
	const cloakProfile = resolveZoomEyeCloakProfile(cloakKit, requestedCloakProfileId);
	ensureHeadfulProfile(cloakProfile);
	const cloakProfileLabel = `${cloakProfile.name} (${cloakProfile.id})`;
	const lease = await openCloakPage(runtime, cloakProfile);

	try {
		const page = lease.page;
		const searchUrl = buildSearchResultUrl(queryBase64, startPage, pageSize, searchType);

		pullLogger.info({ searchUrl, cloakProfile: cloakProfileLabel }, "Opened ZoomEye search page. Waiting for authenticated user badge...");
		await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
		const authenticatedUser = await waitForAuthenticatedUser(page, expectedUserText, authTimeoutMs);
		pullLogger.info({ authenticatedUser }, "ZoomEye authentication detected.");

		const allMatches: ZoomEyeMatch[] = [];
		let pagesFetched = 0;

		for (let pageOffset = 0; pageOffset < totalPagesToFetch; pageOffset += 1) {
			const pageNumber = startPage + pageOffset;
			const apiUrl = buildApiUrl(queryBase64, pageNumber, pageSize, searchType);
			pullLogger.info({ page: pageNumber, apiUrl }, "Waiting for ZoomEye browser search XHR through authenticated session.");

			const payload = await fetchSearchPageFromBrowser(page, {
				queryBase64,
				pageNumber,
				pageSize,
				searchType,
			});
			pullLogger.info({
				page: pageNumber,
				responseUrl: payload.url,
				requestMethod: payload.method,
				resourceType: payload.resourceType,
			}, "Captured ZoomEye browser search response.");
			const parsed = parseSearchResponse(payload, apiUrl);
			const pageMatches = parsed.matches ?? [];
			pagesFetched += 1;
			allMatches.push(...pageMatches);

			if (pageMatches.length < pageSize) {
				break;
			}
		}

		const persistedRecords = toPersistedRecords(allMatches, {
			queryBase64,
			queryText,
			searchType,
			pageSize,
			fetchedAt,
		});
		const storageKit = await ensureStorageKitAttached(runtime, "module:discovery/zoomeye/pull");
		const summary = storageKit.upsertZoomEyeHosts(persistedRecords);
		const previewMatches = Array.from(createUniqueMatchMap(allMatches).values()).slice(0, Math.min(50, persistedRecords.length));
		storageKit.upsertZoomEyeQueryHistory(buildPullHistoryRecord({
			queryBase64,
			queryText,
			searchType,
			pageSize,
			maxResults,
			startPage,
			cloakProfileTarget: requestedCloakProfileId ?? cloakProfile.id,
			resultCount: persistedRecords.length,
			usedAt: fetchedAt,
		}));

		return {
			queryBase64,
			queryText,
			searchType,
			startPage,
			pageSize,
			maxResults,
			authTimeoutMs,
			expectedUserText,
			requestedCloakProfileId,
			authenticatedUser,
			cloakProfile,
			cloakProfileLabel,
			fetchedAt,
			pagesFetched,
			rawMatches: allMatches.length,
			uniqueMatches: persistedRecords.length,
			inserted: summary.inserted,
			updated: summary.updated,
			previewMatches,
		};
	} finally {
		await lease.close();
	}
}

export function readSelectPattern(params: ZoomEyeSelectParams): string {
	const raw = params.pattern ?? params.query;
	if (typeof raw !== "string" || raw.trim().length === 0) {
		throw new InvalidParamsError("Param 'pattern' is required and must be a non-empty regex string.");
	}
	return raw.trim();
}

export function parseSelectRegex(pattern: string): RegExp {
	try {
		return new RegExp(pattern, "iu");
	} catch {
		throw new InvalidParamsError(`Param 'pattern' is not a valid regex: ${pattern}`);
	}
}

export function readSelectField(params: ZoomEyeSelectParams): ZoomEyeSearchableField | null {
	const raw = params.field;
	if (raw === undefined) {
		return null;
	}

	const trimmed = raw.trim() as ZoomEyeSearchableField;
	if (!(ZOOMEYE_SEARCHABLE_FIELDS as readonly string[]).includes(trimmed)) {
		throw new InvalidParamsError(
			`Param 'field' must be one of: ${ZOOMEYE_SEARCHABLE_FIELDS.join(", ")}.`,
		);
	}

	return trimmed;
}

export function rowMatchesPattern(
	row: ZoomEyeHostSelectRow,
	regex: RegExp,
	field: ZoomEyeSearchableField | null,
): boolean {
	const fields: ZoomEyeSearchableField[] = field
		? [field]
		: [...ZOOMEYE_SEARCHABLE_FIELDS];

	for (const currentField of fields) {
		const value = row[currentField as keyof ZoomEyeHostSelectRow];
		if (typeof value === "string" && regex.test(value)) {
			return true;
		}
	}

	return false;
}

export function executeZoomEyeSelect(runtime: Pick<ZoomEyeRuntime, "getStorageKit">, params: ZoomEyeSelectParams): ZoomEyeSelectExecutionResult {
	const pattern = readSelectPattern(params);
	const regex = parseSelectRegex(pattern);
	const field = readSelectField(params);
	const scanLimit = readOptionalPositiveInteger(params.limit, "limit") ?? DEFAULT_SELECT_SCAN_LIMIT;
	const storageKit = ensureStorageKit(runtime.getStorageKit());
	const allRows = storageKit.selectZoomEyeHosts(scanLimit);
	const matches = allRows.filter((row) => rowMatchesPattern(row, regex, field));
	storageKit.upsertZoomEyeQueryHistory(buildSearchHistoryRecord({
		pattern,
		field,
		limit: scanLimit,
		resultCount: matches.length,
		usedAt: new Date().toISOString(),
	}));

	return {
		pattern,
		field,
		scanLimit,
		scannedRows: allRows.length,
		matches,
	};
}

export function readZoomEyeQueryHistory(
	runtime: Pick<ZoomEyeRuntime, "getStorageKit">,
	limit: number = DEFAULT_HISTORY_LIMIT,
	kind?: ZoomEyeQueryHistoryKind,
): ZoomEyeQueryHistoryRow[] {
	const storageKit = ensureStorageKit(runtime.getStorageKit());
	return storageKit.selectZoomEyeQueryHistory(limit, kind);
}

export function buildZoomEyeQuerySuggestions(
	history: readonly ZoomEyeQueryHistoryRow[],
	kind: ZoomEyeQueryHistoryKind,
): string[] {
	const seen = new Set<string>();
	const suggestions: string[] = [];

	for (const row of history) {
		if (row.kind !== kind) {
			continue;
		}

		const candidate = kind === "pull"
			|| kind === "capture"
			? (row.query_text ?? row.label ?? row.query_base64 ?? "")
			: (row.query_text ?? row.label ?? "");
		const normalizedCandidate = candidate.trim();
		if (normalizedCandidate.length === 0 || seen.has(normalizedCandidate)) {
			continue;
		}

		seen.add(normalizedCandidate);
		suggestions.push(normalizedCandidate);
	}

	return suggestions;
}