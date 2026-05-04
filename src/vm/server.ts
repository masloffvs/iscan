import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, posix as path } from "node:path";

import { logger } from "../logger";
import { createTableEntity, createTextEntity, generateVmCode, isVmCode, type OutputEntity } from "../primitives";
import {
  type ModuleRuntime,
  RecoverableVmError,
  loadRecoverableVmSnapshot,
  saveRecoverableVmSnapshot,
  resolveRecoverableVmSnapshotFilePath,
} from "../modules";
import { CloakKit } from "../kits/cloak-kit";
import { BpkgKit } from "../kits/bpkg-kit";
import type { RecoverableVm } from "../modules";
import {
  ensureStorageKit,
  executeSql,
  getSqlNotebookCompletionItems,
  readSchemaSnapshot,
  type SqlExecutionResult,
} from "../modules/sql/console";
import {
  createIsbSnapshotTemplatePath,
  createEmptyIsbFile,
  deleteIsbFile,
  listIsbFiles,
  moveIsbFile,
  normalizeIsbRelativePath,
  readIsbFile,
  rebaseRecoverableVmSnapshot,
  resolveIsbFilePath,
  writeIsbFile,
  type IsbFile,
  type IsbNotebookDocument,
} from "./isb";

export const DEFAULT_VM_SERVER_PORT = 36665;
const VM_SERVER_IDLE_TIMEOUT_SECONDS = 120;

const MAX_VM_CODE_GENERATION_ATTEMPTS = 64;
const VM_SERVER_SNAPSHOT_PREFIX = "vmserver";

type VmCellLanguage = "javascript" | "sql";

type VmInitRequestBody = {
  code?: string;
};

type VmEvalRequestBody = {
  code: string;
  language: VmCellLanguage;
};

type VmCompletionRequestBody = {
  fragment: string;
  language: VmCellLanguage;
};

type VmFileRequestBody = {
  path: string;
};

type VmMoveFileRequestBody = {
  path: string;
  targetPath: string;
};

type VmSaveFileRequestBody = {
  notebook: IsbNotebookDocument;
};

type VmBrowserActionRequestBody = {
  target: string;
  url?: string;
  x?: number;
  y?: number;
};

type VmBrowserGestureRequestBody = {
  target: string;
  points: Array<{
    x: number;
    y: number;
  }>;
};

type VmBrowserWheelRequestBody = {
  target: string;
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
};

type VmBrowserKeyboardRequestBody = {
  target: string;
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

type VmBrowserTabActivationRequestBody = {
  tabId: string;
};

type VmPackageCreateRequestBody = {
  id: string;
  name?: string;
  description?: string;
  packages?: string[];
};

type VmPackageActionRequestBody = {
  target: string;
};

type VmPackageInstallRequestBody = {
  target?: string;
  packages: string[];
};

type VmBrowserStreamSocketData = {
  target: string;
  quality?: number;
  everyNthFrame?: number;
  isClosed?: boolean;
  stopStream?: () => Promise<void>;
};

const VM_BROWSER_STREAM_BINARY_KIND_IMAGE = 1;
const VM_BROWSER_STREAM_BINARY_KIND_AUDIO = 2;

type VmFsWriteRequestBody = {
  path: string;
  content?: string;
  contentBase64?: string;
};

type VmFsDeleteRequestBody = {
  path: string;
  recursive?: boolean;
};

type VmServerSession = {
  code: string;
  relativePath?: string;
  notebook?: IsbNotebookDocument;
  vm: RecoverableVm;
  queue: Promise<void>;
};

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type VmServerResponsePayload = {
  ok: boolean;
  code?: string;
  created?: boolean;
  relativePath?: string;
  snapshotPath?: string;
  result?: unknown;
  error?: string;
};

type ErrorWithCause = Error & { cause?: unknown };

class VmServerHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    if (cause !== undefined) {
      (this as ErrorWithCause).cause = cause;
    }
  }
}

function buildErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}

function createJsonResponse(payload: VmServerResponsePayload, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function createMethodNotAllowedResponse(allowedMethods: readonly string[]): Response {
  return createJsonResponse(
    {
      ok: false,
      error: `Method not allowed. Expected ${allowedMethods.join(" or ")}.`,
    },
    {
      status: 405,
      headers: {
        Allow: allowedMethods.join(", "),
      },
    },
  );
}

function createSnapshotPath(code: string): string {
  return `${VM_SERVER_SNAPSHOT_PREFIX}/${code}.bin`;
}

const VM_RESULT_MAX_DEPTH = 10;

function serializeVmResult(value: unknown, depth = 0, seen = new WeakSet<object>()): JsonValue {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value === "boolean"
    || typeof value === "number"
    || typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ?? "",
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof RegExp || value instanceof URL) {
    return String(value);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("base64");
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64");
  }

  if (Array.isArray(value)) {
    if (depth >= VM_RESULT_MAX_DEPTH) {
      return value.map((entry) => String(entry));
    }

    return value.map((entry) => serializeVmResult(entry, depth + 1, seen));
  }

  if (value instanceof Map) {
    const entries: Record<string, JsonValue> = {};
    for (const [key, entryValue] of value.entries()) {
      entries[String(key)] = serializeVmResult(entryValue, depth + 1, seen);
    }
    return entries;
  }

  if (value instanceof Set) {
    return [...value].map((entry) => serializeVmResult(entry, depth + 1, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    if (depth >= VM_RESULT_MAX_DEPTH) {
      return String(value);
    }

    const entries: Record<string, JsonValue> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      entries[key] = serializeVmResult(entryValue, depth + 1, seen);
    }

    return entries;
  }

  return String(value);
}

async function readJsonBody(request: Request): Promise<unknown> {
  const rawBody = await request.text();
  if (rawBody.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch (error) {
    throw new VmServerHttpError(400, "Invalid JSON request body.", error);
  }
}

function ensureRecordBody(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VmServerHttpError(400, "Request body must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

function normalizeVmCode(rawCode: unknown): string {
  if (typeof rawCode !== "string") {
    throw new VmServerHttpError(400, "VM code must be a string.");
  }

  const trimmedCode = rawCode.trim();
  if (!isVmCode(trimmedCode)) {
    throw new VmServerHttpError(400, "VM code must be a 32-character alphanumeric token.");
  }

  return trimmedCode;
}

function normalizeVmCellLanguage(value: unknown): VmCellLanguage {
  if (value === undefined) {
    return "javascript";
  }

  if (value === "javascript" || value === "sql") {
    return value;
  }

  throw new VmServerHttpError(400, "Notebook request language must be either `javascript` or `sql`.");
}

function normalizeSqlOutputValue(value: unknown): string | number | boolean | null | undefined {
  if (
    value === null
    || value === undefined
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatSqlElapsedMs(elapsedMs: number): string {
  return `${elapsedMs.toFixed(1)} ms`;
}

function buildSqlNotebookOutput(result: SqlExecutionResult): OutputEntity[] {
  if (result.kind === "rows") {
    const summary = createTextEntity(
      `${result.rows.length}${result.truncated ? "+" : ""} row(s) • ${formatSqlElapsedMs(result.elapsedMs)}`,
      {
        tone: "muted",
        meta: {
          kind: result.kind,
          truncated: result.truncated,
          elapsedMs: result.elapsedMs,
        },
      },
    );

    if (result.rows.length === 0 || result.columns.length === 0) {
      return [summary];
    }

    return [
      summary,
      createTableEntity(
        result.columns.map((column) => ({ key: column, header: column })),
        result.rows.map((row) => Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, normalizeSqlOutputValue(value)]),
        )),
        {
          meta: {
            kind: result.kind,
            truncated: result.truncated,
            elapsedMs: result.elapsedMs,
          },
        },
      ),
    ];
  }

  if (result.kind === "write") {
    return [createTextEntity(
      `OK • changes=${result.changes}${result.lastInsertRowid !== null ? ` • lastInsertRowid=${result.lastInsertRowid}` : ""} • ${formatSqlElapsedMs(result.elapsedMs)}`,
      {
        tone: "output",
        meta: {
          kind: result.kind,
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
          elapsedMs: result.elapsedMs,
        },
      },
    )];
  }

  return [createTextEntity(`${result.text} • ${formatSqlElapsedMs(result.elapsedMs)}`, {
    tone: "info",
    meta: {
      kind: result.kind,
      text: result.text,
      elapsedMs: result.elapsedMs,
    },
  })];
}

function readVmEvalRequestBody(value: unknown): VmEvalRequestBody {
  const payload = ensureRecordBody(value);
  if (typeof payload.code !== "string" || payload.code.trim().length === 0) {
    throw new VmServerHttpError(400, "Eval request must include a non-empty string field `code`.");
  }

  return {
    code: payload.code,
    language: normalizeVmCellLanguage(payload.language),
  };
}

function readVmCompletionRequestBody(value: unknown): VmCompletionRequestBody {
  const payload = ensureRecordBody(value);
  if (typeof payload.fragment !== "string") {
    throw new VmServerHttpError(400, "Completion request must include a string field `fragment`.");
  }

  return {
    fragment: payload.fragment,
    language: normalizeVmCellLanguage(payload.language),
  };
}

function readVmInitRequestBody(value: unknown): VmInitRequestBody {
  const payload = ensureRecordBody(value);
  if (payload.code === undefined) {
    return {};
  }

  return {
    code: normalizeVmCode(payload.code),
  };
}

function normalizeIsbPath(rawPath: unknown): string {
  if (typeof rawPath !== "string") {
    throw new VmServerHttpError(400, "ISB path must be a string.");
  }

  try {
    return normalizeIsbRelativePath(rawPath);
  } catch (error) {
    throw new VmServerHttpError(400, buildErrorMessage(error), error);
  }
}

function readVmFileRequestBody(value: unknown): VmFileRequestBody {
  const payload = ensureRecordBody(value);
  return {
    path: normalizeIsbPath(payload.path),
  };
}

function normalizeNotebookDocument(value: unknown, expectedRelativePath: string): IsbNotebookDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VmServerHttpError(400, "Notebook payload must be an object.");
  }

  return {
    ...(value as IsbNotebookDocument),
    id: expectedRelativePath,
    path: expectedRelativePath,
  };
}

function readVmSaveFileRequestBody(value: unknown, expectedRelativePath: string): VmSaveFileRequestBody {
  const payload = ensureRecordBody(value);
  return {
    notebook: normalizeNotebookDocument(payload.notebook, expectedRelativePath),
  };
}

function readVmFsWriteRequestBody(value: unknown): VmFsWriteRequestBody {
  const payload = ensureRecordBody(value);
  if (typeof payload.path !== "string" || payload.path.trim().length === 0) {
    throw new VmServerHttpError(400, "Filesystem write request must include a non-empty string field `path`.");
  }

  if (payload.content !== undefined && typeof payload.content !== "string") {
    throw new VmServerHttpError(400, "Filesystem write request field `content` must be a string.");
  }

  if (payload.contentBase64 !== undefined && typeof payload.contentBase64 !== "string") {
    throw new VmServerHttpError(400, "Filesystem write request field `contentBase64` must be a string.");
  }

  if (payload.content === undefined && payload.contentBase64 === undefined) {
    throw new VmServerHttpError(400, "Filesystem write request must include either `content` or `contentBase64`.");
  }

  return {
    path: payload.path,
    content: payload.content,
    contentBase64: payload.contentBase64,
  };
}

function readVmFsDeleteRequestBody(value: unknown): VmFsDeleteRequestBody {
  const payload = ensureRecordBody(value);
  if (typeof payload.path !== "string" || payload.path.trim().length === 0) {
    throw new VmServerHttpError(400, "Filesystem delete request must include a non-empty string field `path`.");
  }

  if (payload.recursive !== undefined && typeof payload.recursive !== "boolean") {
    throw new VmServerHttpError(400, "Filesystem delete request field `recursive` must be a boolean.");
  }

  return {
    path: payload.path,
    recursive: payload.recursive,
  };
}

function readRequiredQueryPath(url: URL): string {
  const rawPath = url.searchParams.get("path");
  if (!rawPath || rawPath.trim().length === 0) {
    throw new VmServerHttpError(400, "Query parameter `path` is required.");
  }

  return rawPath;
}

function readVmMoveFileRequestBody(value: unknown): VmMoveFileRequestBody {
  if (!value || typeof value !== "object") {
    throw new VmServerHttpError(400, "Move request body must be an object.");
  }

  const payload = value as Partial<VmMoveFileRequestBody>;
  if (typeof payload.path !== "string" || payload.path.trim().length === 0) {
    throw new VmServerHttpError(400, "Move request requires a non-empty `path`.");
  }

  if (typeof payload.targetPath !== "string" || payload.targetPath.trim().length === 0) {
    throw new VmServerHttpError(400, "Move request requires a non-empty `targetPath`.");
  }

  return {
    path: payload.path,
    targetPath: payload.targetPath,
  };
}

function readVmBrowserActionRequestBody(value: unknown): VmBrowserActionRequestBody {
  if (!value || typeof value !== "object") {
    throw new VmServerHttpError(400, "Browser action request body must be an object.");
  }

  const payload = value as Partial<VmBrowserActionRequestBody>;
  if (typeof payload.target !== "string" || payload.target.trim().length === 0) {
    throw new VmServerHttpError(400, "Browser action request requires a non-empty `target`.");
  }

  return {
    target: payload.target,
    url: typeof payload.url === "string" && payload.url.trim().length > 0 ? payload.url.trim() : undefined,
    x: typeof payload.x === "number" && Number.isFinite(payload.x) ? payload.x : undefined,
    y: typeof payload.y === "number" && Number.isFinite(payload.y) ? payload.y : undefined,
  };
}

function readVmBrowserNavigateRequestBody(value: unknown): VmBrowserActionRequestBody {
  const payload = readVmBrowserActionRequestBody(value);
  if (!payload.url) {
    throw new VmServerHttpError(400, "Browser navigate request requires a non-empty `url`.");
  }
  return payload;
}

function readVmBrowserClickRequestBody(value: unknown): Required<Pick<VmBrowserActionRequestBody, "target" | "x" | "y">> {
  const payload = readVmBrowserActionRequestBody(value);
  if (typeof payload.x !== "number" || !Number.isFinite(payload.x)) {
    throw new VmServerHttpError(400, "Browser click request requires a numeric `x`.");
  }

  if (typeof payload.y !== "number" || !Number.isFinite(payload.y)) {
    throw new VmServerHttpError(400, "Browser click request requires a numeric `y`.");
  }

  return {
    target: payload.target,
    x: payload.x,
    y: payload.y,
  };
}

function readVmBrowserGestureRequestBody(value: unknown): VmBrowserGestureRequestBody {
  if (!value || typeof value !== "object") {
    throw new VmServerHttpError(400, "Browser gesture request body must be an object.");
  }

  const payload = value as Partial<VmBrowserGestureRequestBody>;
  if (typeof payload.target !== "string" || payload.target.trim().length === 0) {
    throw new VmServerHttpError(400, "Browser gesture request requires a non-empty `target`.");
  }

  if (!Array.isArray(payload.points) || payload.points.length < 2) {
    throw new VmServerHttpError(400, "Browser gesture request requires at least two points.");
  }

  const points = payload.points.map((point) => {
    if (!point || typeof point !== "object") {
      throw new VmServerHttpError(400, "Browser gesture points must be objects.");
    }

    const candidate = point as { x?: unknown; y?: unknown };
    if (typeof candidate.x !== "number" || !Number.isFinite(candidate.x)) {
      throw new VmServerHttpError(400, "Browser gesture point requires a numeric `x`.");
    }

    if (typeof candidate.y !== "number" || !Number.isFinite(candidate.y)) {
      throw new VmServerHttpError(400, "Browser gesture point requires a numeric `y`.");
    }

    return {
      x: candidate.x,
      y: candidate.y,
    };
  });

  return {
    target: payload.target,
    points,
  };
}

function readVmBrowserWheelRequestBody(value: unknown): VmBrowserWheelRequestBody {
  if (!value || typeof value !== "object") {
    throw new VmServerHttpError(400, "Browser wheel request body must be an object.");
  }

  const payload = value as Partial<VmBrowserWheelRequestBody>;
  if (typeof payload.target !== "string" || payload.target.trim().length === 0) {
    throw new VmServerHttpError(400, "Browser wheel request requires a non-empty `target`.");
  }

  if (typeof payload.x !== "number" || !Number.isFinite(payload.x)) {
    throw new VmServerHttpError(400, "Browser wheel request requires a numeric `x`.");
  }

  if (typeof payload.y !== "number" || !Number.isFinite(payload.y)) {
    throw new VmServerHttpError(400, "Browser wheel request requires a numeric `y`.");
  }

  if (typeof payload.deltaX !== "number" || !Number.isFinite(payload.deltaX)) {
    throw new VmServerHttpError(400, "Browser wheel request requires a numeric `deltaX`.");
  }

  if (typeof payload.deltaY !== "number" || !Number.isFinite(payload.deltaY)) {
    throw new VmServerHttpError(400, "Browser wheel request requires a numeric `deltaY`.");
  }

  return {
    target: payload.target,
    x: payload.x,
    y: payload.y,
    deltaX: payload.deltaX,
    deltaY: payload.deltaY,
  };
}

function readVmBrowserKeyboardRequestBody(value: unknown): VmBrowserKeyboardRequestBody {
  if (!value || typeof value !== "object") {
    throw new VmServerHttpError(400, "Browser keyboard request body must be an object.");
  }

  const payload = value as Partial<VmBrowserKeyboardRequestBody>;
  if (typeof payload.target !== "string" || payload.target.trim().length === 0) {
    throw new VmServerHttpError(400, "Browser keyboard request requires a non-empty `target`.");
  }

  if (typeof payload.key !== "string" || payload.key.length === 0) {
    throw new VmServerHttpError(400, "Browser keyboard request requires a non-empty `key`.");
  }

  return {
    target: payload.target,
    key: payload.key,
    code: typeof payload.code === "string" && payload.code.length > 0 ? payload.code : undefined,
    altKey: payload.altKey === true,
    ctrlKey: payload.ctrlKey === true,
    metaKey: payload.metaKey === true,
    shiftKey: payload.shiftKey === true,
  };
}

function readVmBrowserTabActivationRequestBody(value: unknown): VmBrowserTabActivationRequestBody {
  if (!value || typeof value !== "object") {
    throw new VmServerHttpError(400, "Browser tab activation request body must be an object.");
  }

  const payload = value as Partial<VmBrowserTabActivationRequestBody>;
  if (typeof payload.tabId !== "string" || payload.tabId.trim().length === 0) {
    throw new VmServerHttpError(400, "Browser tab activation request requires a non-empty `tabId`.");
  }

  return {
    tabId: payload.tabId,
  };
}

function readVmPackageCreateRequestBody(value: unknown): VmPackageCreateRequestBody {
  if (!value || typeof value !== "object") {
    throw new VmServerHttpError(400, "Package create request body must be an object.");
  }

  const payload = value as Partial<VmPackageCreateRequestBody>;
  if (typeof payload.id !== "string" || payload.id.trim().length === 0) {
    throw new VmServerHttpError(400, "Package create request requires a non-empty `id`.");
  }

  const packages = (() => {
    if (payload.packages === undefined) {
      return undefined;
    }

    if (!Array.isArray(payload.packages)) {
      throw new VmServerHttpError(400, "Package create request `packages` must be a string array.");
    }

    const normalizedPackages = payload.packages
      .map((entry) => typeof entry === "string" ? entry.trim() : "")
      .filter(Boolean);
    return normalizedPackages.length > 0 ? normalizedPackages : undefined;
  })();

  return {
    id: payload.id.trim(),
    name: typeof payload.name === "string" && payload.name.trim().length > 0 ? payload.name.trim() : undefined,
    description: typeof payload.description === "string" && payload.description.trim().length > 0
      ? payload.description.trim()
      : undefined,
    packages,
  };
}

function readVmPackageActionRequestBody(value: unknown): VmPackageActionRequestBody {
  if (!value || typeof value !== "object") {
    throw new VmServerHttpError(400, "Package action request body must be an object.");
  }

  const payload = value as Partial<VmPackageActionRequestBody>;
  if (typeof payload.target !== "string" || payload.target.trim().length === 0) {
    throw new VmServerHttpError(400, "Package action request requires a non-empty `target`.");
  }

  return {
    target: payload.target.trim(),
  };
}

function readVmPackageInstallRequestBody(value: unknown): VmPackageInstallRequestBody {
  if (!value || typeof value !== "object") {
    throw new VmServerHttpError(400, "Package install request body must be an object.");
  }

  const payload = value as Partial<VmPackageInstallRequestBody>;
  if (!Array.isArray(payload.packages)) {
    throw new VmServerHttpError(400, "Package install request requires a `packages` string array.");
  }

  const packages = payload.packages
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter(Boolean);
  if (packages.length === 0) {
    throw new VmServerHttpError(400, "Package install request requires at least one package id.");
  }

  return {
    target: typeof payload.target === "string" && payload.target.trim().length > 0 ? payload.target.trim() : undefined,
    packages,
  };
}

function readOptionalPositiveIntegerQueryParam(
  url: URL,
  key: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  const rawValue = url.searchParams.get(key);
  if (rawValue === null || rawValue.trim().length === 0) {
    return undefined;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue)) {
    throw new VmServerHttpError(400, `Query parameter \`${key}\` must be an integer.`);
  }

  if (options.min !== undefined && parsedValue < options.min) {
    throw new VmServerHttpError(400, `Query parameter \`${key}\` must be >= ${options.min}.`);
  }

  if (options.max !== undefined && parsedValue > options.max) {
    throw new VmServerHttpError(400, `Query parameter \`${key}\` must be <= ${options.max}.`);
  }

  return parsedValue;
}

class VmServerSessions {
  private readonly sessions = new Map<string, VmServerSession>();
  private readonly sessionLoads = new Map<string, Promise<VmServerSession>>();
  private readonly sessionCodesByPath = new Map<string, string>();

  constructor(private readonly runtime: ModuleRuntime<any>) {}

  async createNewSession(): Promise<{ session: VmServerSession; created: true }> {
    const code = this.allocateUniqueCode();
    const session = await this.instantiateSession(code, { persistEmptySnapshot: true });
    return {
      session,
      created: true,
    };
  }

  async initializeExistingSession(code: string): Promise<{ session: VmServerSession; created: false }> {
    const session = await this.getOrLoadSession(code);
    return {
      session,
      created: false,
    };
  }

  async createFileSession(relativePath: string): Promise<{ session: VmServerSession; created: true }> {
    const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
    const existingSession = this.getSessionByPath(normalizedRelativePath);
    if (existingSession || existsSync(resolveIsbFilePath(normalizedRelativePath).filePath)) {
      throw new VmServerHttpError(409, `ISB file already exists: ${normalizedRelativePath}`);
    }

    const isbFile = createEmptyIsbFile(normalizedRelativePath);
    await writeIsbFile(isbFile);

    const session = await this.instantiateFileSession(isbFile);
    return {
      session,
      created: true,
    };
  }

  async openFileSession(relativePath: string): Promise<{ session: VmServerSession; created: false }> {
    const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
    const existingSession = this.getSessionByPath(normalizedRelativePath);
    if (existingSession) {
      return {
        session: existingSession,
        created: false,
      };
    }

    let isbFile: IsbFile;
    try {
      isbFile = await readIsbFile(normalizedRelativePath);
    } catch (error) {
      throw new VmServerHttpError(404, buildErrorMessage(error), error);
    }

    const session = await this.instantiateFileSession(isbFile);
    return {
      session,
      created: false,
    };
  }

  async deleteFile(relativePath: string): Promise<{ path: string }> {
    const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
    if (!existsSync(resolveIsbFilePath(normalizedRelativePath).filePath)) {
      throw new VmServerHttpError(404, `ISB file not found: ${normalizedRelativePath}`);
    }

    const existingSession = this.getSessionByPath(normalizedRelativePath);
    if (existingSession) {
      await this.runExclusive(existingSession, async () => {
        await deleteIsbFile(normalizedRelativePath);
        await this.disposeSession(existingSession);
      });
    } else {
      await deleteIsbFile(normalizedRelativePath);
    }

    return { path: normalizedRelativePath };
  }

  async moveFile(relativePath: string, targetPath: string): Promise<{ path: string; targetPath: string }> {
    const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
    const normalizedTargetPath = normalizeIsbRelativePath(targetPath);
    if (normalizedRelativePath === normalizedTargetPath) {
      throw new VmServerHttpError(400, "Move target must differ from the current notebook path.");
    }

    if (!existsSync(resolveIsbFilePath(normalizedRelativePath).filePath)) {
      throw new VmServerHttpError(404, `ISB file not found: ${normalizedRelativePath}`);
    }

    if (
      existsSync(resolveIsbFilePath(normalizedTargetPath).filePath)
      || this.getSessionByPath(normalizedTargetPath)
    ) {
      throw new VmServerHttpError(409, `ISB file already exists: ${normalizedTargetPath}`);
    }

    const existingSession = this.getSessionByPath(normalizedRelativePath);
    if (existingSession) {
      await this.runExclusive(existingSession, async () => {
        const movedFile = await moveIsbFile(normalizedRelativePath, normalizedTargetPath);
        this.rebindSessionPath(existingSession, movedFile.relativePath, movedFile.notebook);
      });
    } else {
      await moveIsbFile(normalizedRelativePath, normalizedTargetPath);
    }

    return {
      path: normalizedRelativePath,
      targetPath: normalizedTargetPath,
    };
  }

  private async getNotebookStorageKit() {
    return await ensureStorageKit({
      getStorageKit: () => this.runtime.getStorageKit(),
      runtime: this.runtime,
    });
  }

  private async evaluateSqlCell(input: string): Promise<OutputEntity[]> {
    const query = input.trim();
    if (query.length === 0) {
      throw new VmServerHttpError(400, "SQL cell cannot be empty.");
    }

    const storageKit = await this.getNotebookStorageKit();
    return buildSqlNotebookOutput(await executeSql(storageKit, query));
  }

  private async evaluateWithLanguage(code: string, input: string, language: VmCellLanguage): Promise<unknown> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const result = language === "sql"
        ? await this.evaluateSqlCell(input)
        : await session.vm.eval(input);
      await this.persistBoundFileSession(session);
      return result;
    });
  }

  async evaluate(code: string, input: string, language: VmCellLanguage = "javascript"): Promise<unknown> {
    return await this.evaluateWithLanguage(code, input, language);
  }

  async getNotebookCompletions(
    code: string,
    fragment: string,
    language: VmCellLanguage = "javascript",
  ): Promise<ReturnType<ModuleRuntime<any>["getNotebookCompletionItems"]>> {
    await this.getOrLoadSession(code);

    if (language === "sql") {
      const storageKit = await this.getNotebookStorageKit();
      const schema = await readSchemaSnapshot(storageKit);
      return getSqlNotebookCompletionItems(fragment, schema);
    }

    return this.runtime.getNotebookCompletionItems(fragment);
  }

  async saveFileSession(code: string, notebook: IsbNotebookDocument): Promise<VmServerSession> {
    const session = await this.getOrLoadSession(code);
    if (!session.relativePath) {
      throw new VmServerHttpError(400, `VM code ${code} is not bound to an ISB file.`);
    }

    await this.runExclusive(session, async () => {
      await this.persistBoundFileSession(session, { notebook });
    });

    return session;
  }

  async restartFileSession(code: string): Promise<VmServerSession> {
    const session = await this.getOrLoadSession(code);
    if (!session.relativePath) {
      throw new VmServerHttpError(400, `VM code ${code} is not bound to an ISB file.`);
    }

    await this.runExclusive(session, async () => {
      const isbFile = await this.readBoundIsbFile(session);
      await this.hydrateFileSession(session, isbFile, {
        notebook: session.notebook ?? isbFile.notebook,
        replaySnapshot: true,
      });
    });

    return session;
  }

  async reloadFileSession(code: string): Promise<VmServerSession> {
    const session = await this.getOrLoadSession(code);
    if (!session.relativePath) {
      throw new VmServerHttpError(400, `VM code ${code} is not bound to an ISB file.`);
    }

    await this.runExclusive(session, async () => {
      const isbFile = await this.readBoundIsbFile(session);
      await this.hydrateFileSession(session, isbFile, {
        notebook: isbFile.notebook,
        replaySnapshot: false,
      });
    });

    return session;
  }

  async listFsDirectory(code: string, dirPath: string): Promise<{
    path: string;
    entries: Array<{
      name: string;
      path: string;
      kind: "file" | "directory";
      size: number;
      mtimeMs: number;
    }>;
  }> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const normalizedPath = this.normalizeFsPath(session, dirPath);

      try {
        const entries = session.vm.fs.readdirSync(normalizedPath)
          .map((name) => {
            const childPath = normalizedPath === "/" ? `/${name}` : `${normalizedPath}/${name}`;
            const stats = session.vm.fs.statSync(childPath);
            return {
              name,
              path: childPath,
              kind: stats.isDirectory() ? "directory" : "file",
              size: stats.size,
              mtimeMs: stats.mtimeMs,
            };
          })
          .sort((left, right) => {
            if (left.kind !== right.kind) {
              return left.kind === "directory" ? -1 : 1;
            }

            return left.name.localeCompare(right.name);
          });

        return {
          path: normalizedPath,
          entries,
        };
      } catch (error) {
        this.throwFsHttpError(error);
      }
    });
  }

  async readFsFile(code: string, filePath: string): Promise<{
    path: string;
    name: string;
    size: number;
    mtimeMs: number;
    isText: boolean;
    content?: string;
    contentBase64?: string;
  }> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const normalizedPath = this.normalizeFsPath(session, filePath);

      try {
        const stats = session.vm.fs.statSync(normalizedPath);
        if (!stats.isFile()) {
          throw Object.assign(new Error(`Path is not a file: ${normalizedPath}`), { code: "EISDIR" });
        }

        const buffer = session.vm.fs.readFileSync(normalizedPath) as Buffer;
        try {
          const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
          return {
            path: normalizedPath,
            name: basename(normalizedPath),
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            isText: true,
            content,
          };
        } catch {
          return {
            path: normalizedPath,
            name: basename(normalizedPath),
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            isText: false,
            contentBase64: buffer.toString("base64"),
          };
        }
      } catch (error) {
        this.throwFsHttpError(error);
      }
    });
  }

  async writeFsFile(
    code: string,
    filePath: string,
    options: { content?: string; contentBase64?: string },
  ): Promise<{
    path: string;
    size: number;
    mtimeMs: number;
  }> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const normalizedPath = this.normalizeFsPath(session, filePath);
      const parentPath = path.dirname(normalizedPath);

      try {
        if (!session.vm.fs.existsSync(parentPath)) {
          session.vm.fs.mkdirSync(parentPath, { recursive: true });
        }

        const data = options.contentBase64 !== undefined
          ? Buffer.from(options.contentBase64, "base64")
          : options.content ?? "";
        session.vm.fs.writeFileSync(normalizedPath, data);
        await this.persistBoundFileSession(session);
        const stats = session.vm.fs.statSync(normalizedPath);
        return {
          path: normalizedPath,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        };
      } catch (error) {
        this.throwFsHttpError(error);
      }
    });
  }

  async mkdirFsDirectory(code: string, dirPath: string): Promise<{ path: string }> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const normalizedPath = this.normalizeFsPath(session, dirPath);

      try {
        session.vm.fs.mkdirSync(normalizedPath, { recursive: true });
        await this.persistBoundFileSession(session);
        return { path: normalizedPath };
      } catch (error) {
        this.throwFsHttpError(error);
      }
    });
  }

  async deleteFsEntry(
    code: string,
    targetPath: string,
    options: { recursive?: boolean } = {},
  ): Promise<{ path: string }> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const normalizedPath = this.normalizeFsPath(session, targetPath);

      try {
        session.vm.fs.rmSync(normalizedPath, {
          recursive: options.recursive ?? true,
          force: false,
        });
        await this.persistBoundFileSession(session);
        return { path: normalizedPath };
      } catch (error) {
        this.throwFsHttpError(error);
      }
    });
  }

  async downloadFsFile(code: string, filePath: string): Promise<{
    path: string;
    name: string;
    buffer: Buffer;
  }> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const normalizedPath = this.normalizeFsPath(session, filePath);

      try {
        const stats = session.vm.fs.statSync(normalizedPath);
        if (!stats.isFile()) {
          throw Object.assign(new Error(`Path is not a file: ${normalizedPath}`), { code: "EISDIR" });
        }

        const buffer = session.vm.fs.readFileSync(normalizedPath) as Buffer;
        return {
          path: normalizedPath,
          name: basename(normalizedPath),
          buffer,
        };
      } catch (error) {
        this.throwFsHttpError(error);
      }
    });
  }

  private allocateUniqueCode(): string {
    for (let attempt = 0; attempt < MAX_VM_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const code = generateVmCode();
      if (this.sessions.has(code) || this.snapshotExists(code)) {
        continue;
      }

      return code;
    }

    throw new VmServerHttpError(500, "Failed to allocate a unique VM code.");
  }

  private async instantiateSession(
    code: string,
    options: { persistEmptySnapshot?: boolean } = {},
  ): Promise<VmServerSession> {
    const vm = this.runtime.createRecoverableVm(createSnapshotPath(code));
    await vm.prepare();
    if (options.persistEmptySnapshot) {
      await vm.save();
    }

    const session: VmServerSession = {
      code,
      vm,
      queue: Promise.resolve(),
    };
    this.registerSession(session);
    return session;
  }

  private async instantiateFileSession(isbFile: IsbFile): Promise<VmServerSession> {
    const existingSession = this.getSessionByPath(isbFile.relativePath);
    if (existingSession) {
      return existingSession;
    }

    const code = this.allocateUniqueCode();
    const snapshotPath = createSnapshotPath(code);
    await saveRecoverableVmSnapshot(
      rebaseRecoverableVmSnapshot(isbFile.snapshot, snapshotPath),
    );

    const vm = this.runtime.createRecoverableVm(snapshotPath);
    await vm.prepare({ replaySnapshot: false });
    const session: VmServerSession = {
      code,
      relativePath: isbFile.relativePath,
      notebook: isbFile.notebook,
      vm,
      queue: Promise.resolve(),
    };
    this.registerSession(session);
    return session;
  }

  private async persistBoundFileSession(
    session: VmServerSession,
    options: { notebook?: IsbNotebookDocument } = {},
  ): Promise<void> {
    if (!session.relativePath) {
      return;
    }

    const currentFile = await this.readBoundIsbFile(session);
    const currentSnapshot = await loadRecoverableVmSnapshot(session.vm.getSnapshotPath());
    const persistedSnapshot = rebaseRecoverableVmSnapshot(
      currentSnapshot,
      createIsbSnapshotTemplatePath(session.relativePath),
    );
    const notebook = options.notebook ?? session.notebook ?? currentFile.notebook;

    await writeIsbFile({
      ...currentFile,
      notebook,
      snapshot: persistedSnapshot,
      savedAt: Date.now(),
    });
    session.notebook = notebook;
  }

  private async readBoundIsbFile(session: VmServerSession): Promise<IsbFile> {
    if (!session.relativePath) {
      throw new VmServerHttpError(400, `VM code ${session.code} is not bound to an ISB file.`);
    }

    try {
      return await readIsbFile(session.relativePath);
    } catch (error) {
      throw new VmServerHttpError(404, buildErrorMessage(error), error);
    }
  }

  private async hydrateFileSession(
    session: VmServerSession,
    isbFile: IsbFile,
    options: { notebook: IsbNotebookDocument; replaySnapshot?: boolean },
  ): Promise<void> {
    const snapshotPath = createSnapshotPath(session.code);
    await saveRecoverableVmSnapshot(
      rebaseRecoverableVmSnapshot(isbFile.snapshot, snapshotPath),
    );

    const vm = this.runtime.createRecoverableVm(snapshotPath);
    await vm.prepare({ replaySnapshot: options.replaySnapshot ?? true });
    session.vm = vm;
    session.notebook = options.notebook;
  }

  private normalizeFsPath(session: VmServerSession, rawPath: string): string {
    if (typeof rawPath !== "string") {
      throw new VmServerHttpError(400, "Filesystem path must be a string.");
    }

    try {
      return session.vm.fs.normalizePath(rawPath);
    } catch (error) {
      throw new VmServerHttpError(400, buildErrorMessage(error), error);
    }
  }

  private throwFsHttpError(error: unknown): never {
    const fsCode = error instanceof Error && "code" in error
      ? String(error.code)
      : null;
    if (fsCode === "ENOENT") {
      throw new VmServerHttpError(404, buildErrorMessage(error), error);
    }

    if (fsCode === "EEXIST" || fsCode === "ENOTEMPTY") {
      throw new VmServerHttpError(409, buildErrorMessage(error), error);
    }

    throw new VmServerHttpError(400, buildErrorMessage(error), error);
  }

  private async disposeSession(session: VmServerSession): Promise<void> {
    this.sessions.delete(session.code);
    if (session.relativePath) {
      this.sessionCodesByPath.delete(session.relativePath);
    }

    await rm(session.vm.getSnapshotFilePath(), { force: true }).catch(() => undefined);
  }

  private rebindSessionPath(
    session: VmServerSession,
    nextRelativePath: string,
    notebook: IsbNotebookDocument,
  ): void {
    if (session.relativePath) {
      this.sessionCodesByPath.delete(session.relativePath);
    }

    session.relativePath = nextRelativePath;
    session.notebook = notebook;
    this.sessionCodesByPath.set(nextRelativePath, session.code);
  }

  private registerSession(session: VmServerSession): void {
    this.sessions.set(session.code, session);
    if (session.relativePath) {
      this.sessionCodesByPath.set(session.relativePath, session.code);
    }
  }

  private getSessionByPath(relativePath: string): VmServerSession | null {
    const code = this.sessionCodesByPath.get(relativePath);
    if (!code) {
      return null;
    }

    return this.sessions.get(code) ?? null;
  }

  private async getOrLoadSession(code: string): Promise<VmServerSession> {
    const existingSession = this.sessions.get(code);
    if (existingSession) {
      return existingSession;
    }

    const existingLoad = this.sessionLoads.get(code);
    if (existingLoad) {
      return await existingLoad;
    }

    if (!this.snapshotExists(code)) {
      throw new VmServerHttpError(404, `Unknown VM code: ${code}`);
    }

    const nextLoad = this.instantiateSession(code)
      .finally(() => {
        this.sessionLoads.delete(code);
      });
    this.sessionLoads.set(code, nextLoad);

    return await nextLoad;
  }

  private snapshotExists(code: string): boolean {
    return existsSync(resolveRecoverableVmSnapshotFilePath(createSnapshotPath(code)).filePath);
  }

  private async runExclusive<T>(session: VmServerSession, action: () => Promise<T>): Promise<T> {
    const nextRun = session.queue
      .catch(() => undefined)
      .then(async () => await action());
    session.queue = nextRun.then(
      () => undefined,
      () => undefined,
    );
    return await nextRun;
  }
}

function createErrorResponse(error: unknown): Response {
  if (error instanceof VmServerHttpError) {
    return createJsonResponse({ ok: false, error: error.message }, { status: error.status });
  }

  if (error instanceof RecoverableVmError) {
    return createJsonResponse({ ok: false, error: error.message }, { status: 400 });
  }

  return createJsonResponse(
    {
      ok: false,
      error: buildErrorMessage(error),
    },
    {
      status: 500,
    },
  );
}

export async function startVmServer(runtime: ModuleRuntime<any>, port = DEFAULT_VM_SERVER_PORT): Promise<never> {
  const sessions = new VmServerSessions(runtime);
  let cloakKit: CloakKit | null = runtime.getCloakKit();
  let bpkgKit: BpkgKit | null = runtime.getKit<BpkgKit>("bpkg");

  async function ensureCloakKit(): Promise<CloakKit> {
    cloakKit = cloakKit ?? await runtime.attachKit(new CloakKit(), { reason: "browser management" });
    return cloakKit;
  }

  async function ensureBpkgKit(): Promise<BpkgKit> {
    bpkgKit = bpkgKit ?? await runtime.attachKit(new BpkgKit(), { reason: "package box management" });
    return bpkgKit;
  }

  const server = Bun.serve<VmBrowserStreamSocketData>({
    port,
    idleTimeout: VM_SERVER_IDLE_TIMEOUT_SECONDS,
    async fetch(request, server) {
      const startedAt = Date.now();
      const url = new URL(request.url);

      if (url.pathname === "/vm/browsers/stream") {
        if (request.method !== "GET") {
          return createMethodNotAllowedResponse(["GET"]);
        }

        try {
          const target = url.searchParams.get("target")?.trim();
          if (!target) {
            return createJsonResponse(
              {
                ok: false,
                error: "Browser stream request requires a non-empty `target`.",
              },
              { status: 400 },
            );
          }

          const quality = readOptionalPositiveIntegerQueryParam(url, "quality", { min: 1, max: 100 });
          const everyNthFrame = readOptionalPositiveIntegerQueryParam(url, "everyNthFrame", { min: 1, max: 10 });

          const upgraded = server.upgrade(request, {
            data: {
              target,
              quality,
              everyNthFrame,
            },
          });

          if (upgraded) {
            logger.info(
              {
                method: request.method,
                path: url.pathname,
                status: 101,
                durationMs: Date.now() - startedAt,
                target,
                quality,
                everyNthFrame,
              },
              "VM browser stream upgraded",
            );
            return;
          }

          return createJsonResponse(
            {
              ok: false,
              error: "Failed to upgrade browser stream websocket.",
            },
            { status: 400 },
          );
        } catch (error) {
          return createErrorResponse(error);
        }
      }

      let response: Response;
      try {
        response = await handleVmServerRequest(request, url, sessions, ensureCloakKit, ensureBpkgKit);
      } catch (error) {
        logger.error({ error }, "VM server request failed");
        response = createErrorResponse(error);
      }

      logger.info(
        {
          method: request.method,
          path: url.pathname,
          status: response.status,
          durationMs: Date.now() - startedAt,
        },
        "VM server request",
      );

      return response;
    },
    websocket: {
      open(ws) {
        logger.info({ target: ws.data.target }, "VM browser stream opened");

        void (async () => {
          let tabsIntervalId: ReturnType<typeof setInterval> | null = null;
          try {
            const kit = await ensureCloakKit();
            let lastTabsSignature: string | null = null;

            const sendTabsSnapshot = async () => {
              const tabs = await kit.listProfileTabs(ws.data.target);
              const nextSignature = JSON.stringify(tabs);
              if (nextSignature === lastTabsSignature) {
                return;
              }

              lastTabsSignature = nextSignature;
              ws.send(JSON.stringify({
                type: "tabs",
                tabs,
              }));
            };

            const screencast = await kit.startProfileScreencast(ws.data.target, {
              format: "jpeg",
              quality: ws.data.quality,
              everyNthFrame: ws.data.everyNthFrame,
              onFrame(frame) {
                const payload = new Uint8Array(frame.bytes.length + 1);
                payload[0] = VM_BROWSER_STREAM_BINARY_KIND_IMAGE;
                payload.set(frame.bytes, 1);
                ws.send(payload);
              },
              onAudioChunk(chunk) {
                const payload = new Uint8Array(chunk.bytes.length + 1);
                payload[0] = VM_BROWSER_STREAM_BINARY_KIND_AUDIO;
                payload.set(chunk.bytes, 1);
                ws.send(payload);
              },
            });

            tabsIntervalId = setInterval(() => {
              void sendTabsSnapshot().catch(() => {});
            }, 900);

            if (ws.data.isClosed) {
              if (tabsIntervalId) {
                clearInterval(tabsIntervalId);
              }
              await screencast.stop();
              return;
            }

            ws.data.stopStream = async () => {
              if (tabsIntervalId) {
                clearInterval(tabsIntervalId);
                tabsIntervalId = null;
              }

              await screencast.stop();
            };
            ws.send(JSON.stringify({
              type: "ready",
              transport: "screencast",
              audioMimeType: screencast.audioMimeType,
              mimeType: "image/jpeg",
              quality: ws.data.quality ?? 35,
              everyNthFrame: ws.data.everyNthFrame ?? 1,
            }));
            await sendTabsSnapshot();
          } catch (error) {
            const message = buildErrorMessage(error);
            try {
              ws.send(JSON.stringify({
                type: "error",
                error: message,
              }));
            } catch {
              // Ignore send failures on closed sockets.
            }

            ws.close(1011, "Browser stream failed");
          }
        })();
      },
      close(ws) {
        ws.data.isClosed = true;
        const stopStream = ws.data.stopStream;
        ws.data.stopStream = undefined;
        logger.info({ target: ws.data.target }, "VM browser stream closed");
        void stopStream?.();
      },
    },
  });

  logger.info({ port: server.port, idleTimeoutSeconds: VM_SERVER_IDLE_TIMEOUT_SECONDS }, "VM server started");

  return await new Promise<never>(() => {});
}

async function handleVmServerRequest(
  request: Request,
  url: URL,
  sessions: VmServerSessions,
  ensureCloakKit: () => Promise<CloakKit>,
  ensureBpkgKit: () => Promise<BpkgKit>,
): Promise<Response> {
  if (url.pathname === "/vm/files") {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    return createJsonResponse({
      ok: true,
      result: {
        files: await listIsbFiles(),
      },
    });
  }

  if (url.pathname === "/vm/files/create") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmFileRequestBody(await readJsonBody(request));
    const created = await sessions.createFileSession(body.path);

    return createJsonResponse(
      {
        ok: true,
        code: created.session.code,
        created: true,
        relativePath: created.session.relativePath,
        snapshotPath: created.session.vm.getSnapshotPath(),
        result: {
          notebook: created.session.notebook,
        },
      },
      {
        status: 201,
      },
    );
  }

  if (url.pathname === "/vm/files/open") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmFileRequestBody(await readJsonBody(request));
    const opened = await sessions.openFileSession(body.path);

    return createJsonResponse({
      ok: true,
      code: opened.session.code,
      created: false,
      relativePath: opened.session.relativePath,
      snapshotPath: opened.session.vm.getSnapshotPath(),
      result: {
        notebook: opened.session.notebook,
      },
    });
  }

  if (url.pathname === "/vm/files/delete") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmFileRequestBody(await readJsonBody(request));
    const deleted = await sessions.deleteFile(body.path);

    return createJsonResponse({
      ok: true,
      result: deleted,
    });
  }

  if (url.pathname === "/vm/files/move") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmMoveFileRequestBody(await readJsonBody(request));
    const moved = await sessions.moveFile(body.path, body.targetPath);

    return createJsonResponse({
      ok: true,
      result: moved,
    });
  }

  if (url.pathname === "/vm/browsers") {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const kit = await ensureCloakKit();
    const profiles = kit.getProfiles();
    const browsers = profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      proxy: profile.proxy,
      userDataDir: profile.userDataDir,
      headless: profile.headless ?? false,
      humanize: profile.humanize ?? false,
      isRunning: kit.isProfileRunning(profile.id),
      profileDir: profile.userDataDir,
      currentUrl: kit.getProfileCurrentUrl(profile.id),
    }));

    return createJsonResponse({
      ok: true,
      result: {
        browsers,
      },
    });
  }

  if (url.pathname === "/vm/packages") {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const kit = await ensureBpkgKit();
    const snapshot = kit.inspect();

    return createJsonResponse({
      ok: true,
      result: {
        boxes: snapshot.boxes,
        defaultBoxId: snapshot.defaultBoxId,
        hostInfo: snapshot.hostInfo,
        supportedPackages: kit.listSupportedPackages(),
      },
    });
  }

  if (url.pathname === "/vm/packages/create") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmPackageCreateRequestBody(await readJsonBody(request));
    const kit = await ensureBpkgKit();
    const box = await kit.createBox(body);

    return createJsonResponse({
      ok: true,
      result: {
        box,
      },
    });
  }

  if (url.pathname === "/vm/packages/select") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmPackageActionRequestBody(await readJsonBody(request));
    const kit = await ensureBpkgKit();
    const box = await kit.selectDefaultBox(body.target);

    return createJsonResponse({
      ok: true,
      result: {
        target: body.target,
        box,
      },
    });
  }

  if (url.pathname === "/vm/packages/install") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmPackageInstallRequestBody(await readJsonBody(request));
    const kit = await ensureBpkgKit();
    const installed = await kit.installSupportedPackages(body.packages, body.target);

    return createJsonResponse({
      ok: true,
      result: {
        target: installed.box.id,
        box: installed.box,
        packageIds: installed.packageIds,
        pacmanPackages: installed.pacmanPackages,
        paruPackages: installed.paruPackages,
      },
    });
  }

  const browserTabsMatch = url.pathname.match(/^\/vm\/browsers\/([^/]+)\/tabs$/u);
  if (browserTabsMatch) {
    const target = decodeURIComponent(browserTabsMatch[1]!);
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const kit = await ensureCloakKit();
    const tabs = await kit.listProfileTabs(target);

    return createJsonResponse({
      ok: true,
      result: {
        target,
        tabs,
      },
    });
  }

  const browserActivateTabMatch = url.pathname.match(/^\/vm\/browsers\/([^/]+)\/tabs\/activate$/u);
  if (browserActivateTabMatch) {
    const target = decodeURIComponent(browserActivateTabMatch[1]!);
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserTabActivationRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.activateProfileTab(target, body.tabId);

    return createJsonResponse({
      ok: true,
      result: {
        target,
        tabId: body.tabId,
      },
    });
  }

  if (url.pathname === "/vm/browsers/launch") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserActionRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.launchProfile(body.target, { headless: true });

    return createJsonResponse({
      ok: true,
      result: {
        target: body.target,
      },
    });
  }

  if (url.pathname === "/vm/browsers/navigate") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserNavigateRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.navigateProfile(body.target, body.url!);

    return createJsonResponse({
      ok: true,
      result: {
        target: body.target,
      },
    });
  }

  if (url.pathname === "/vm/browsers/screenshot") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserActionRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    const dataUrl = await kit.captureProfileScreenshot(body.target);

    return createJsonResponse({
      ok: true,
      result: {
        target: body.target,
        dataUrl,
      },
    });
  }

  if (url.pathname === "/vm/browsers/click") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserClickRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.clickProfile(body.target, body.x, body.y);

    return createJsonResponse({
      ok: true,
      result: {
        target: body.target,
      },
    });
  }

  if (url.pathname === "/vm/browsers/gesture") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserGestureRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.gestureProfile(body.target, body.points);

    return createJsonResponse({
      ok: true,
      result: {
        target: body.target,
      },
    });
  }

  if (url.pathname === "/vm/browsers/wheel") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserWheelRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.wheelProfile(body.target, body.x, body.y, body.deltaX, body.deltaY);

    return createJsonResponse({
      ok: true,
      result: {
        target: body.target,
      },
    });
  }

  if (url.pathname === "/vm/browsers/keyboard") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserKeyboardRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.keyboardProfile(body.target, body);

    return createJsonResponse({
      ok: true,
      result: {
        target: body.target,
      },
    });
  }

  if (url.pathname === "/vm/browsers/stop") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmBrowserActionRequestBody(await readJsonBody(request));
    const kit = await ensureCloakKit();
    await kit.stopProfile(body.target);

    return createJsonResponse({
      ok: true,
      result: {
        target: body.target,
      },
    });
  }

  const saveMatch = url.pathname.match(/^\/vm\/([^/]+)\/file$/u);
  if (saveMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(saveMatch[1] ?? ""));
    const session = await sessions.initializeExistingSession(vmCode);
    if (!session.session.relativePath) {
      throw new VmServerHttpError(400, `VM code ${vmCode} is not bound to an ISB file.`);
    }

    const body = readVmSaveFileRequestBody(
      await readJsonBody(request),
      session.session.relativePath,
    );
    const savedSession = await sessions.saveFileSession(vmCode, body.notebook);

    return createJsonResponse({
      ok: true,
      code: savedSession.code,
      created: false,
      relativePath: savedSession.relativePath,
      snapshotPath: savedSession.vm.getSnapshotPath(),
      result: {
        notebook: savedSession.notebook,
      },
    });
  }

  const restartMatch = url.pathname.match(/^\/vm\/([^/]+)\/restart$/u);
  if (restartMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(restartMatch[1] ?? ""));
    const restarted = await sessions.restartFileSession(vmCode);

    return createJsonResponse({
      ok: true,
      code: restarted.code,
      created: false,
      relativePath: restarted.relativePath,
      snapshotPath: restarted.vm.getSnapshotPath(),
      result: {
        notebook: restarted.notebook,
      },
    });
  }

  const reloadMatch = url.pathname.match(/^\/vm\/([^/]+)\/reload$/u);
  if (reloadMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(reloadMatch[1] ?? ""));
    const reloaded = await sessions.reloadFileSession(vmCode);

    return createJsonResponse({
      ok: true,
      code: reloaded.code,
      created: false,
      relativePath: reloaded.relativePath,
      snapshotPath: reloaded.vm.getSnapshotPath(),
      result: {
        notebook: reloaded.notebook,
      },
    });
  }

  const fsListMatch = url.pathname.match(/^\/vm\/([^/]+)\/fs\/list$/u);
  if (fsListMatch) {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(fsListMatch[1] ?? ""));
    const result = await sessions.listFsDirectory(vmCode, readRequiredQueryPath(url));
    return createJsonResponse({ ok: true, result });
  }

  const fsReadMatch = url.pathname.match(/^\/vm\/([^/]+)\/fs\/read$/u);
  if (fsReadMatch) {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(fsReadMatch[1] ?? ""));
    const result = await sessions.readFsFile(vmCode, readRequiredQueryPath(url));
    return createJsonResponse({ ok: true, result });
  }

  const fsWriteMatch = url.pathname.match(/^\/vm\/([^/]+)\/fs\/write$/u);
  if (fsWriteMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(fsWriteMatch[1] ?? ""));
    const body = readVmFsWriteRequestBody(await readJsonBody(request));
    const result = await sessions.writeFsFile(vmCode, body.path, {
      content: body.content,
      contentBase64: body.contentBase64,
    });
    return createJsonResponse({ ok: true, result });
  }

  const fsMkdirMatch = url.pathname.match(/^\/vm\/([^/]+)\/fs\/mkdir$/u);
  if (fsMkdirMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(fsMkdirMatch[1] ?? ""));
    const body = readVmFileRequestBody(await readJsonBody(request));
    const result = await sessions.mkdirFsDirectory(vmCode, body.path);
    return createJsonResponse({ ok: true, result });
  }

  const fsDeleteMatch = url.pathname.match(/^\/vm\/([^/]+)\/fs\/delete$/u);
  if (fsDeleteMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(fsDeleteMatch[1] ?? ""));
    const body = readVmFsDeleteRequestBody(await readJsonBody(request));
    const result = await sessions.deleteFsEntry(vmCode, body.path, { recursive: body.recursive });
    return createJsonResponse({ ok: true, result });
  }

  const fsDownloadMatch = url.pathname.match(/^\/vm\/([^/]+)\/fs\/download$/u);
  if (fsDownloadMatch) {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(fsDownloadMatch[1] ?? ""));
    const result = await sessions.downloadFsFile(vmCode, readRequiredQueryPath(url));
    return new Response(result.buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${result.name}"`,
      },
    });
  }

  if (url.pathname === "/health") {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    return createJsonResponse({ ok: true, result: { status: "ready" } });
  }

  if (url.pathname === "/vm/init") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmInitRequestBody(await readJsonBody(request));
    const initialized = body.code
      ? await sessions.initializeExistingSession(body.code)
      : await sessions.createNewSession();

    return createJsonResponse(
      {
        ok: true,
        code: initialized.session.code,
        created: initialized.created,
        snapshotPath: initialized.session.vm.getSnapshotPath(),
      },
      {
        status: initialized.created ? 201 : 200,
      },
    );
  }

  const evalMatch = url.pathname.match(/^\/vm\/([^/]+)\/eval$/u);
  if (evalMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(evalMatch[1] ?? ""));
    const body = readVmEvalRequestBody(await readJsonBody(request));
    const result = await sessions.evaluate(vmCode, body.code, body.language);
    return createJsonResponse({
      ok: true,
      result: serializeVmResult(result),
    });
  }

  const completionsMatch = url.pathname.match(/^\/vm\/([^/]+)\/completions$/u);
  if (completionsMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(completionsMatch[1] ?? ""));
    const body = readVmCompletionRequestBody(await readJsonBody(request));
    const items = await sessions.getNotebookCompletions(vmCode, body.fragment, body.language);
    return createJsonResponse({
      ok: true,
      result: {
        items,
      },
    });
  }

  return createJsonResponse(
    {
      ok: false,
      error: "Not found.",
    },
    {
      status: 404,
    },
  );
}