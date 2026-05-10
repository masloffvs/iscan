import { CloakKit } from "../../../kits/cloak-kit";
import { StorageKit } from "../../../kits/storage-kit";
import { executeAuditCrawl, type AuditCrawlParams } from "../../../modules/audit/crawl.shared";
import {
	createJsonResponse,
	createMethodNotAllowedResponse,
	ensureRecordBody,
	readJsonBody,
	VmServerHttpError,
} from "../http";

type AuditRouteRuntime = {
	attachKit: <T>(kit: T, options?: { reason?: string }) => Promise<T>;
	getCloakKit: () => CloakKit | null;
	getStorageKit: () => StorageKit | null;
};

let storageKit: StorageKit | null = null;

function getStorageKit(): StorageKit {
	storageKit = storageKit ?? new StorageKit();
	return storageKit;
}

function normalizeOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function normalizeOptionalInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value)
		? value
		: undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean"
		? value
		: undefined;
}

function normalizeFetchMode(value: unknown): "http" | "browser" | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (value === "http" || value === "browser") {
		return value;
	}

	throw new VmServerHttpError(400, "Param 'fetchMode' must be either 'http' or 'browser'.");
}

function normalizeAuditCrawlParams(body: Record<string, unknown>): AuditCrawlParams {
	return {
		url: normalizeOptionalString(body.url),
		timeoutMs: normalizeOptionalInteger(body.timeoutMs),
		maxAssets: normalizeOptionalInteger(body.maxAssets),
		maxAssetKb: normalizeOptionalInteger(body.maxAssetKb),
		sameOriginOnly: normalizeOptionalBoolean(body.sameOriginOnly),
		fetchMode: normalizeFetchMode(body.fetchMode),
		cloakProfileId: normalizeOptionalString(body.cloakProfileId),
		renderMs: normalizeOptionalInteger(body.renderMs),
	};
}

function createAuditRouteRuntime(
	ensureCloakKit: () => Promise<CloakKit>,
): AuditRouteRuntime {
	let cloakKit: CloakKit | null = null;

	return {
		async attachKit<T>(kit: T): Promise<T> {
			if (kit instanceof StorageKit) {
				return getStorageKit() as T;
			}

			if (kit instanceof CloakKit || (kit && typeof kit === "object" && kit.constructor?.name === "CloakKit")) {
				cloakKit = await ensureCloakKit();
				return cloakKit as T;
			}

			return kit;
		},
		getCloakKit() {
			return cloakKit;
		},
		getStorageKit() {
			return storageKit;
		},
	};
}

export async function handleAuditRoutes(
	request: Request,
	url: URL,
	ensureCloakKit: () => Promise<CloakKit>,
): Promise<Response | null> {
	if (url.pathname !== "/vm/audit/crawl") {
		return null;
	}

	if (request.method !== "POST") {
		return createMethodNotAllowedResponse(["POST"]);
	}

	const body = ensureRecordBody(await readJsonBody(request));
	const runtime = createAuditRouteRuntime(ensureCloakKit);
	const result = await executeAuditCrawl(runtime, console, normalizeAuditCrawlParams(body));

	return createJsonResponse({
		ok: true,
		result,
	});
}