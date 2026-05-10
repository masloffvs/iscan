import { Buffer } from "node:buffer";

import { $axios } from "../../../axios";
import { StorageKit, type PersistedHttpClientSavedRequestRecord } from "../../../kits/storage-kit";
import { readOptionalPositiveIntegerQueryParam } from "../parsers";
import {
  createJsonResponse,
  createMethodNotAllowedResponse,
  ensureRecordBody,
  readJsonBody,
  VmServerHttpError,
} from "../http";

const HTTP_CLIENT_AXIOS_INSTANCE_ID = "http-client:postman";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_PREVIEW_CHARS = 8_000;
const FORBIDDEN_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
]);
const ALLOWED_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

type SupportedHttpMethod = typeof ALLOWED_HTTP_METHODS[number];

type NormalizedHttpClientRequest = {
  method: SupportedHttpMethod;
  url: string;
  headers: Record<string, string>;
  bodyText: string | null;
  timeoutMs: number;
};

type HttpClientSavedRequestSnapshot = {
  statusCode: number | null;
  durationMs: number | null;
  responseHeaders: unknown;
  responseBodyPreview: string | null;
  responseContentType: string | null;
  responseSizeBytes: number | null;
  executedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHttpMethod(value: unknown): SupportedHttpMethod {
  if (typeof value !== "string") {
    throw new VmServerHttpError(400, "Request body field `method` must be a string.");
  }

  const normalizedMethod = value.trim().toUpperCase();
  if (!ALLOWED_HTTP_METHODS.includes(normalizedMethod as SupportedHttpMethod)) {
    throw new VmServerHttpError(400, `HTTP method '${value}' is not supported.`);
  }

  return normalizedMethod as SupportedHttpMethod;
}

function normalizeHttpUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VmServerHttpError(400, "Request body field `url` must be a non-empty string.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value.trim());
  } catch (error) {
    throw new VmServerHttpError(400, "Request body field `url` must be a valid URL.", error);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new VmServerHttpError(400, "Only http:// and https:// URLs are supported.");
  }

  return parsedUrl.toString();
}

function normalizeSavedRequestUrl(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value !== "string") {
    throw new VmServerHttpError(400, "Request body field `url` must be a string when provided.");
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return "";
  }

  return normalizeHttpUrl(trimmedValue);
}

function normalizeTimeoutMs(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_TIMEOUT_MS;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new VmServerHttpError(400, "Request body field `timeoutMs` must be a finite number.");
  }

  const normalizedTimeout = Math.round(value);
  if (normalizedTimeout < 1 || normalizedTimeout > MAX_TIMEOUT_MS) {
    throw new VmServerHttpError(400, `Request body field \`timeoutMs\` must be between 1 and ${MAX_TIMEOUT_MS}.`);
  }

  return normalizedTimeout;
}

function normalizeBodyText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new VmServerHttpError(400, "Request body field `bodyText` must be a string when provided.");
  }

  return value;
}

function stringifyJsonValue(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new VmServerHttpError(400, `Request body field \`${fieldName}\` must be JSON-serializable.`, error);
  }
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw new VmServerHttpError(400, "Request body field `headers` must be a JSON object.");
  }

  const normalizedHeaders: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const headerName = rawName.trim();
    if (headerName.length === 0) {
      continue;
    }

    const canonicalHeaderName = headerName.toLowerCase();
    if (FORBIDDEN_REQUEST_HEADERS.has(canonicalHeaderName)) {
      continue;
    }

    if (typeof rawValue !== "string") {
      throw new VmServerHttpError(400, `Header '${rawName}' must have a string value.`);
    }

    normalizedHeaders[headerName] = rawValue;
  }

  return normalizedHeaders;
}

function normalizeResponseHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const normalizedHeaders: Record<string, string> = {};
  for (const [headerName, headerValue] of Object.entries(value)) {
    if (Array.isArray(headerValue)) {
			normalizedHeaders[headerName] = headerName.toLowerCase() === "set-cookie"
				? headerValue.map((entry) => String(entry)).join("\n")
				: headerValue.map((entry) => String(entry)).join(", ");
      continue;
    }

    if (headerValue === undefined || headerValue === null) {
      continue;
    }

    normalizedHeaders[headerName] = String(headerValue);
  }

  return normalizedHeaders;
}

function normalizeHttpClientRequest(body: Record<string, unknown>): NormalizedHttpClientRequest {
  return {
    method: normalizeHttpMethod(body.method),
    url: normalizeHttpUrl(body.url),
    headers: normalizeHeaders(body.headers),
    bodyText: normalizeBodyText(body.bodyText),
    timeoutMs: normalizeTimeoutMs(body.timeoutMs),
  };
}

function normalizeSavedRequestName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VmServerHttpError(400, "Request body field `name` must be a non-empty string.");
  }

  return value.trim();
}

function normalizeSavedRequestId(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return crypto.randomUUID();
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VmServerHttpError(400, "Request body field `id` must be a non-empty string when provided.");
  }

  return value.trim();
}

function normalizeRequiredSavedRequestId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VmServerHttpError(400, "Request body field `id` must be a non-empty string.");
  }

  return value.trim();
}

function normalizeSavedRequestBodyKind(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new VmServerHttpError(400, "Request body field `bodyKind` must be a string when provided.");
  }

  return value.trim() || null;
}

function normalizeSavedRequestSnapshot(value: unknown): HttpClientSavedRequestSnapshot {
  if (value === undefined || value === null) {
    return {
      statusCode: null,
      durationMs: null,
      responseHeaders: null,
      responseBodyPreview: null,
      responseContentType: null,
      responseSizeBytes: null,
      executedAt: null,
    };
  }

  if (!isRecord(value)) {
    throw new VmServerHttpError(400, "Request body field `lastResponseSnapshot` must be a JSON object.");
  }

  const normalizeOptionalInteger = (rawValue: unknown, fieldName: string): number | null => {
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      return null;
    }

    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new VmServerHttpError(400, `Request body field \`${fieldName}\` must be a finite number.`);
    }

    return Math.round(rawValue);
  };

  const normalizeOptionalString = (rawValue: unknown, fieldName: string): string | null => {
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      return null;
    }

    if (typeof rawValue !== "string") {
      throw new VmServerHttpError(400, `Request body field \`${fieldName}\` must be a string when provided.`);
    }

    return rawValue;
  };

  return {
    statusCode: normalizeOptionalInteger(value.statusCode, "lastResponseSnapshot.statusCode"),
    durationMs: normalizeOptionalInteger(value.durationMs, "lastResponseSnapshot.durationMs"),
    responseHeaders: value.responseHeaders,
    responseBodyPreview: normalizeOptionalString(value.responseBodyPreview, "lastResponseSnapshot.responseBodyPreview"),
    responseContentType: normalizeOptionalString(value.responseContentType, "lastResponseSnapshot.responseContentType"),
    responseSizeBytes: normalizeOptionalInteger(value.responseSizeBytes, "lastResponseSnapshot.responseSizeBytes"),
    executedAt: normalizeOptionalString(value.executedAt, "lastResponseSnapshot.executedAt"),
  };
}

function getStorageKit(): StorageKit {
  return new StorageKit();
}

function normalizeSavedRequestRecord(body: Record<string, unknown>): PersistedHttpClientSavedRequestRecord {
  const now = new Date().toISOString();
  const existingRecord = typeof body.id === "string" ? getStorageKit().selectHttpClientSavedRequestById(body.id.trim()) : null;
  const snapshot = normalizeSavedRequestSnapshot(body.lastResponseSnapshot);

  return {
    id: normalizeSavedRequestId(body.id),
    name: normalizeSavedRequestName(body.name),
    method: normalizeHttpMethod(body.method),
    url: normalizeSavedRequestUrl(body.url),
    headersJson: stringifyJsonValue(body.headers, "headers"),
    queryJson: stringifyJsonValue(body.query, "query"),
    bodyText: normalizeBodyText(body.bodyText),
    bodyKind: normalizeSavedRequestBodyKind(body.bodyKind),
    lastStatusCode: snapshot.statusCode,
    lastDurationMs: snapshot.durationMs,
    lastResponseHeadersJson: stringifyJsonValue(snapshot.responseHeaders, "lastResponseSnapshot.responseHeaders"),
    lastResponseBodyPreview: snapshot.responseBodyPreview,
    lastResponseContentType: snapshot.responseContentType,
    lastResponseSizeBytes: snapshot.responseSizeBytes,
    lastExecutedAt: snapshot.executedAt,
    createdAt: existingRecord?.created_at ?? now,
    updatedAt: now,
  };
}

function createResponsePreview(bodyText: string | null): string | null {
  if (!bodyText || bodyText.length === 0) {
    return null;
  }

  if (bodyText.length <= MAX_RESPONSE_PREVIEW_CHARS) {
    return bodyText;
  }

  return `${bodyText.slice(0, MAX_RESPONSE_PREVIEW_CHARS)}...`;
}

function tokenizeCurlCommand(input: string): string[] {
  const normalizedInput = input.replace(/\\\r?\n/gu, " ").trim();
  const tokens: string[] = [];
  let currentToken = "";
  let quoteMode: 'single' | 'double' | null = null;
  let escaped = false;

  for (const char of normalizedInput) {
    if (escaped) {
      currentToken += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quoteMode !== "single") {
      escaped = true;
      continue;
    }

    if (quoteMode === "single") {
      if (char === "'") {
        quoteMode = null;
      } else {
        currentToken += char;
      }
      continue;
    }

    if (quoteMode === "double") {
      if (char === '"') {
        quoteMode = null;
      } else {
        currentToken += char;
      }
      continue;
    }

    if (char === "'") {
      quoteMode = "single";
      continue;
    }

    if (char === '"') {
      quoteMode = "double";
      continue;
    }

    if (/\s/iu.test(char)) {
      if (currentToken.length > 0) {
        tokens.push(currentToken);
        currentToken = "";
      }
      continue;
    }

    currentToken += char;
  }

  if (quoteMode !== null) {
    throw new VmServerHttpError(400, "Curl command contains an unclosed quote.");
  }

  if (escaped) {
    currentToken += "\\";
  }

  if (currentToken.length > 0) {
    tokens.push(currentToken);
  }

  return tokens;
}

function readCurlOptionValue(tokens: readonly string[], index: number, token: string, prefix: string): { value: string; nextIndex: number } {
  if (token.length > prefix.length) {
    return {
      value: token.slice(prefix.length),
      nextIndex: index,
    };
  }

  const nextToken = tokens[index + 1];
  if (typeof nextToken !== "string") {
    throw new VmServerHttpError(400, `Curl option '${prefix}' requires a value.`);
  }

  return {
    value: nextToken,
    nextIndex: index + 1,
  };
}

function parseCurlHeader(headerLine: string): { name: string; value: string } {
  const separatorIndex = headerLine.indexOf(":");
  if (separatorIndex <= 0) {
    throw new VmServerHttpError(400, `Invalid curl header '${headerLine}'. Expected 'Name: value'.`);
  }

  const headerName = headerLine.slice(0, separatorIndex).trim();
  const headerValue = headerLine.slice(separatorIndex + 1).trim();
  if (headerName.length === 0) {
    throw new VmServerHttpError(400, `Invalid curl header '${headerLine}'. Header name is required.`);
  }

  return {
    name: headerName,
    value: headerValue,
  };
}

function parseCurlCommand(input: string): NormalizedHttpClientRequest {
  const tokens = tokenizeCurlCommand(input);
  if (tokens.length === 0) {
    throw new VmServerHttpError(400, "Curl command must not be empty.");
  }

  const startIndex = tokens[0] === "curl" ? 1 : 0;
  let method: SupportedHttpMethod | null = null;
  let url: string | null = null;
  const headers: Record<string, string> = {};
  const bodyParts: string[] = [];

  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (token === "-I" || token === "--head") {
      method = "HEAD";
      continue;
    }

    if (token === "-X" || token.startsWith("-X") || token.startsWith("--request=") || token === "--request") {
      const { value, nextIndex } = token.startsWith("--request=")
        ? { value: token.slice("--request=".length), nextIndex: index }
        : readCurlOptionValue(tokens, index, token, token === "-X" ? "-X" : "--request");
      method = normalizeHttpMethod(value);
      index = nextIndex;
      continue;
    }

    if (token === "--url" || token.startsWith("--url=")) {
      const { value, nextIndex } = token.startsWith("--url=")
        ? { value: token.slice("--url=".length), nextIndex: index }
        : readCurlOptionValue(tokens, index, token, "--url");
      url = normalizeHttpUrl(value);
      index = nextIndex;
      continue;
    }

    if (token === "-H" || token.startsWith("-H") || token === "--header" || token.startsWith("--header=")) {
      const { value, nextIndex } = token.startsWith("--header=")
        ? { value: token.slice("--header=".length), nextIndex: index }
        : readCurlOptionValue(tokens, index, token, token === "-H" ? "-H" : "--header");
      const parsedHeader = parseCurlHeader(value);
      if (!FORBIDDEN_REQUEST_HEADERS.has(parsedHeader.name.toLowerCase())) {
        headers[parsedHeader.name] = parsedHeader.value;
      }
      index = nextIndex;
      continue;
    }

    if (
      token === "-d"
      || token.startsWith("-d")
      || token === "--data"
      || token.startsWith("--data=")
      || token === "--data-raw"
      || token.startsWith("--data-raw=")
      || token === "--data-binary"
      || token.startsWith("--data-binary=")
      || token === "--data-ascii"
      || token.startsWith("--data-ascii=")
    ) {
      const optionPrefix = token.startsWith("--data-raw=")
        ? "--data-raw="
        : token.startsWith("--data-binary=")
          ? "--data-binary="
          : token.startsWith("--data-ascii=")
            ? "--data-ascii="
            : token.startsWith("--data=")
              ? "--data="
              : token === "--data-raw"
                ? "--data-raw"
                : token === "--data-binary"
                  ? "--data-binary"
                  : token === "--data-ascii"
                    ? "--data-ascii"
                    : token === "--data"
                      ? "--data"
                      : "-d";
      const { value, nextIndex } = optionPrefix.endsWith("=")
        ? { value: token.slice(optionPrefix.length), nextIndex: index }
        : readCurlOptionValue(tokens, index, token, optionPrefix);
      bodyParts.push(value);
      if (method === null) {
        method = "POST";
      }
      index = nextIndex;
      continue;
    }

    if (token === "-u" || token.startsWith("-u") || token === "--user" || token.startsWith("--user=")) {
      const { value, nextIndex } = token.startsWith("--user=")
        ? { value: token.slice("--user=".length), nextIndex: index }
        : readCurlOptionValue(tokens, index, token, token === "-u" ? "-u" : "--user");
      headers.Authorization = `Basic ${Buffer.from(value, "utf8").toString("base64")}`;
      index = nextIndex;
      continue;
    }

    if ((token.startsWith("http://") || token.startsWith("https://")) && url === null) {
      url = normalizeHttpUrl(token);
    }
  }

  if (!url) {
    throw new VmServerHttpError(400, "Curl command must include an http:// or https:// URL.");
  }

  return {
    method: method ?? "GET",
    url,
    headers,
    bodyText: bodyParts.length > 0 ? bodyParts.join("&") : null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

async function executeHttpClientRequest(requestConfig: NormalizedHttpClientRequest): Promise<{
  request: NormalizedHttpClientRequest;
  response: {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    contentType: string | null;
    bodyText: string | null;
    bodyPreview: string | null;
    sizeBytes: number;
    durationMs: number;
  } | null;
  error: {
    code: string | null;
    message: string;
  } | null;
}> {
  const client = $axios.with({
    instanceId: HTTP_CLIENT_AXIOS_INSTANCE_ID,
    headers: {},
  });

  const startedAt = Date.now();
  try {
    const response = await client.request({
      data: requestConfig.bodyText ?? undefined,
      headers: requestConfig.headers,
      maxRedirects: 5,
      method: requestConfig.method,
      responseType: "text",
      timeout: requestConfig.timeoutMs,
      transitional: {
        forcedJSONParsing: false,
      },
      url: requestConfig.url,
      validateStatus: () => true,
    });

    const bodyText = typeof response.data === "string"
      ? response.data
      : response.data === undefined || response.data === null
        ? null
        : String(response.data);
    const responseHeaders = normalizeResponseHeaders(response.headers);

    return {
      request: requestConfig,
      response: {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        contentType: responseHeaders["content-type"] ?? null,
        bodyText,
        bodyPreview: createResponsePreview(bodyText),
        sizeBytes: Buffer.byteLength(bodyText ?? "", "utf8"),
        durationMs: Date.now() - startedAt,
      },
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = isRecord(error) && typeof error.code === "string" ? error.code : null;

    return {
      request: requestConfig,
      response: null,
      error: {
        code,
        message,
      },
    };
  }
}

export async function handleHttpClientRoutes(
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (url.pathname === "/vm/http-client/execute") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = ensureRecordBody(await readJsonBody(request));
    const requestConfig = normalizeHttpClientRequest(body);
    return createJsonResponse({
      ok: true,
      result: await executeHttpClientRequest(requestConfig),
    });
  }

  if (url.pathname === "/vm/http-client/import-curl") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = ensureRecordBody(await readJsonBody(request));
    if (typeof body.curl !== "string" || body.curl.trim().length === 0) {
      throw new VmServerHttpError(400, "Request body field `curl` must be a non-empty string.");
    }

    return createJsonResponse({
      ok: true,
      result: {
        request: parseCurlCommand(body.curl),
      },
    });
  }

  if (url.pathname === "/vm/http-client/requests") {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const limit = readOptionalPositiveIntegerQueryParam(url, "limit", { min: 1, max: 200 }) ?? 50;
    const offset = readOptionalPositiveIntegerQueryParam(url, "offset", { min: 0, max: 10_000 }) ?? 0;
    return createJsonResponse({
      ok: true,
      result: {
        requests: getStorageKit().selectHttpClientSavedRequests(limit, offset),
      },
    });
  }

  if (url.pathname === "/vm/http-client/requests/save") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = ensureRecordBody(await readJsonBody(request));
    const savedRequest = getStorageKit().upsertHttpClientSavedRequest(normalizeSavedRequestRecord(body));
    return createJsonResponse({
      ok: true,
      result: {
        request: savedRequest,
      },
    });
  }

  if (url.pathname === "/vm/http-client/requests/delete") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = ensureRecordBody(await readJsonBody(request));
    const requestId = normalizeRequiredSavedRequestId(body.id);
    return createJsonResponse({
      ok: true,
      result: {
        deleted: getStorageKit().deleteHttpClientSavedRequest(requestId),
        id: requestId,
      },
    });
    }

  const savedRequestMatch = url.pathname.match(/^\/vm\/http-client\/requests\/([^/]+)$/u);
  if (savedRequestMatch) {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const requestId = decodeURIComponent(savedRequestMatch[1]!);
    return createJsonResponse({
      ok: true,
      result: {
        request: getStorageKit().selectHttpClientSavedRequestById(requestId),
      },
    });
  }

  return null;
}