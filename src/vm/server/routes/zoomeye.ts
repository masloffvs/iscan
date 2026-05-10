import type { CloakKit } from "../../../kits/cloak-kit";
import { StorageKit } from "../../../kits/storage-kit";
import {
  getZoomEyePassiveCaptureSession,
  startZoomEyePassiveCapture,
  stopZoomEyePassiveCapture,
  executeZoomEyePull,
  type ZoomEyePassiveCaptureParams,
  type ZoomEyePullParams,
} from "../../../modules/discovery/zoomeye.shared";
import {
  createJsonResponse,
  createMethodNotAllowedResponse,
  ensureRecordBody,
  readJsonBody,
  VmServerHttpError,
} from "../http";

type ZoomEyeRouteRuntime = {
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

function normalizePullParams(body: Record<string, unknown>): ZoomEyePullParams {
  return {
    queryBase64: normalizeOptionalString(body.queryBase64),
    query: normalizeOptionalString(body.query),
    startPage: normalizeOptionalInteger(body.startPage),
    pageSize: normalizeOptionalInteger(body.pageSize),
    maxResults: normalizeOptionalInteger(body.maxResults),
    searchType: normalizeOptionalString(body.searchType),
    authTimeoutMs: normalizeOptionalInteger(body.authTimeoutMs),
    expectedUserText: normalizeOptionalString(body.expectedUserText),
    cloakProfileId: normalizeOptionalString(body.cloakProfileId),
  };
}

function normalizePassiveCaptureParams(body: Record<string, unknown>): ZoomEyePassiveCaptureParams {
  return {
    cloakProfileId: normalizeOptionalString(body.cloakProfileId),
  };
}

function createZoomEyeRouteRuntime(
  ensureCloakKit: () => Promise<CloakKit>,
): ZoomEyeRouteRuntime {
  let cloakKit: CloakKit | null = null;

  return {
    async attachKit<T>(kit: T): Promise<T> {
      if (kit instanceof StorageKit) {
        return getStorageKit() as T;
      }

      if (kit && typeof kit === "object" && kit instanceof Object && kit.constructor?.name === "CloakKit") {
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

export async function handleZoomEyeRoutes(
  request: Request,
  url: URL,
  ensureCloakKit: () => Promise<CloakKit>,
): Promise<Response | null> {
  const hostMatch = url.pathname.match(/^\/vm\/discovery\/zoomeye\/hosts\/([^/]+)\/([^/]+)$/u);
  if (hostMatch) {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const ip = decodeURIComponent(hostMatch[1]!);
    const port = Number.parseInt(decodeURIComponent(hostMatch[2]!), 10);
    if (!Number.isInteger(port) || port <= 0) {
      throw new VmServerHttpError(400, "ZoomEye host detail route requires a positive integer port.");
    }

    return createJsonResponse({
      ok: true,
      result: {
        host: getStorageKit().selectZoomEyeHostByEndpoint(ip, port),
      },
    });
  }

  if (url.pathname === "/vm/discovery/zoomeye/capture") {
    const runtime = createZoomEyeRouteRuntime(ensureCloakKit);
    if (request.method === "GET") {
      const cloakProfileId = normalizeOptionalString(url.searchParams.get("cloakProfileId"));
      const session = await getZoomEyePassiveCaptureSession(runtime, { cloakProfileId });
      return createJsonResponse({
        ok: true,
        result: {
          session,
        },
      });
    }

    if (request.method === "POST") {
      const body = ensureRecordBody(await readJsonBody(request));
      const session = await startZoomEyePassiveCapture(runtime, console, normalizePassiveCaptureParams(body));
      return createJsonResponse({
        ok: true,
        result: {
          session,
        },
      });
    }

    return createMethodNotAllowedResponse(["GET", "POST"]);
  }

  if (url.pathname === "/vm/discovery/zoomeye/capture/stop") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = ensureRecordBody(await readJsonBody(request));
    const runtime = createZoomEyeRouteRuntime(ensureCloakKit);
    const session = await stopZoomEyePassiveCapture(runtime, normalizePassiveCaptureParams(body));
    return createJsonResponse({
      ok: true,
      result: {
        session,
      },
    });
  }

  if (url.pathname !== "/vm/discovery/zoomeye/pull") {
    return null;
  }

  if (request.method !== "POST") {
    return createMethodNotAllowedResponse(["POST"]);
  }

  const body = ensureRecordBody(await readJsonBody(request));
  const runtime = createZoomEyeRouteRuntime(ensureCloakKit);
  const result = await executeZoomEyePull(runtime, console, normalizePullParams(body));
  const entries = getStorageKit().selectZoomEyeHostsByBatch(
    result.queryBase64,
    result.fetchedAt,
    Math.max(result.uniqueMatches, 1),
  );

  return createJsonResponse({
    ok: true,
    result: {
      queryBase64: result.queryBase64,
      queryText: result.queryText,
      searchType: result.searchType,
      fetchedAt: result.fetchedAt,
      summary: {
        authenticatedUser: result.authenticatedUser,
        cloakProfileId: result.cloakProfile.id,
        cloakProfileLabel: result.cloakProfileLabel,
        inserted: result.inserted,
        maxResults: result.maxResults,
        pageSize: result.pageSize,
        pagesFetched: result.pagesFetched,
        rawMatches: result.rawMatches,
        requestedCloakProfileId: result.requestedCloakProfileId,
        startPage: result.startPage,
        uniqueMatches: result.uniqueMatches,
        updated: result.updated,
      },
      entries,
    },
  });
}