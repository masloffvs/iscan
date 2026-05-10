import { Buffer } from "node:buffer";
import {
  parseBpkgSandboxPolicyExtensionsInput,
  type BpkgPrivilegeLevel,
  type BpkgSandboxPolicyExtensionsInput,
} from "../../kits/bpkg-kit";
import { isVmCode } from "../../primitives";
import { normalizeIsbRelativePath } from "../isb";
import type { IsbNotebookDocument } from "../isb";
import { VmServerHttpError, buildErrorMessage, ensureRecordBody } from "./http";
import { decodeSocketMessage } from "./utils";
import type {
  VmBrowserActionRequestBody,
  VmBrowserStreamClientMessage,
  VmBrowserGestureRequestBody,
  VmBrowserKeyboardRequestBody,
  VmBrowserProfileUpdateRequestBody,
  VmBrowserTabActivationRequestBody,
  VmBrowserTextRequestBody,
  VmBrowserWheelRequestBody,
  VmCellLanguage,
  VmCompletionRequestBody,
  VmEvalRequestBody,
  VmExecutionStreamClientMessage,
  VmFileRequestBody,
  VmFsDeleteRequestBody,
  VmFsWriteRequestBody,
  VmInitRequestBody,
  VmInspectorStreamClientMessage,
  VmMoveFileRequestBody,
  VmPackageActionRequestBody,
  VmPackageCreateRequestBody,
  VmPackageInstallRequestBody,
  VmPackagePrivilegeRequestBody,
  VmPackageTerminalClientMessage,
  VmSaveFileRequestBody,
} from "./types";

// ─── VM code ─────────────────────────────────────────────────────────────────

export function normalizeVmCode(rawCode: unknown): string {
  if (typeof rawCode !== "string") {
    throw new VmServerHttpError(400, "VM code must be a string.");
  }

  const trimmedCode = rawCode.trim();
  if (!isVmCode(trimmedCode)) {
    throw new VmServerHttpError(400, "VM code must be a 32-character alphanumeric token.");
  }

  return trimmedCode;
}

// ─── Cell language ───────────────────────────────────────────────────────────

export function normalizeVmCellLanguage(value: unknown): VmCellLanguage {
  if (value === undefined) {
    return "javascript";
  }

  if (value === "javascript" || value === "sql") {
    return value;
  }

  throw new VmServerHttpError(400, "Notebook request language must be either `javascript` or `sql`.");
}

// ─── Shared string helpers ────────────────────────────────────────────────────

export function normalizeRequiredTrimmedString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new VmServerHttpError(400, `${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new VmServerHttpError(400, `${fieldName} must be a non-empty string.`);
  }

  return trimmed;
}

export function normalizeOptionalTrimmedString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return normalizeRequiredTrimmedString(value, fieldName);
}

export function normalizeRequiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new VmServerHttpError(400, `${fieldName} must be a boolean.`);
  }

  return value;
}

export function normalizeOptionalViewportDimension(
  value: unknown,
  fieldName: string,
  range: { min: number; max: number },
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numericValue)) {
    throw new VmServerHttpError(400, `${fieldName} must be an integer.`);
  }

  if (numericValue < range.min || numericValue > range.max) {
    throw new VmServerHttpError(400, `${fieldName} must be between ${range.min} and ${range.max}.`);
  }

  return numericValue;
}

// ─── ISB path ─────────────────────────────────────────────────────────────────

export function normalizeIsbPath(rawPath: unknown): string {
  if (typeof rawPath !== "string") {
    throw new VmServerHttpError(400, "ISB path must be a string.");
  }

  try {
    return normalizeIsbRelativePath(rawPath);
  } catch (error) {
    throw new VmServerHttpError(400, buildErrorMessage(error), error);
  }
}

// ─── Query params ─────────────────────────────────────────────────────────────

export function readRequiredQueryPath(url: URL): string {
  const rawPath = url.searchParams.get("path");
  if (!rawPath || rawPath.trim().length === 0) {
    throw new VmServerHttpError(400, "Query parameter `path` is required.");
  }

  return rawPath;
}

export function readOptionalPositiveIntegerQueryParam(
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

export function readOptionalPrivilegeLevelQueryParam(url: URL, key: string): BpkgPrivilegeLevel | undefined {
  return readOptionalVmPrivilegeLevel(url.searchParams.get(key), key);
}

// ─── Privilege level ──────────────────────────────────────────────────────────

export function readOptionalVmPrivilegeLevel(value: unknown, fieldName: string): BpkgPrivilegeLevel | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new VmServerHttpError(400, `\`${fieldName}\` must be a string.`);
  }

  const normalized = value.trim();
  if (normalized === "sandbox-ro" || normalized === "sandbox-rw" || normalized === "host-privileged") {
    return normalized;
  }

  throw new VmServerHttpError(400, `\`${fieldName}\` must be one of sandbox-ro, sandbox-rw, host-privileged.`);
}

export function readOptionalVmPrivilegeLevelArray(value: unknown, fieldName: string): BpkgPrivilegeLevel[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new VmServerHttpError(400, `\`${fieldName}\` must be an array of strings.`);
  }

  return value.map((entry, index) => {
    const privilegeLevel = readOptionalVmPrivilegeLevel(entry, `${fieldName}[${index}]`);
    if (!privilegeLevel) {
      throw new VmServerHttpError(400, `\`${fieldName}[${index}]\` must be a non-empty privilege level.`);
    }

    return privilegeLevel;
  });
}

export function readOptionalVmSandboxPolicyExtensions(
  value: unknown,
  fieldName: string,
): BpkgSandboxPolicyExtensionsInput | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  try {
    return parseBpkgSandboxPolicyExtensionsInput(value, fieldName);
  } catch (error) {
    throw new VmServerHttpError(400, buildErrorMessage(error));
  }
}

function readOptionalVmPolicyBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new VmServerHttpError(400, `\`${fieldName}\` must be a boolean.`);
  }

  return value;
}

// ─── Request bodies ───────────────────────────────────────────────────────────

export function readVmInitRequestBody(value: unknown): VmInitRequestBody {
  const payload = ensureRecordBody(value);
  if (payload.code === undefined) {
    return {};
  }

  return {
    code: normalizeVmCode(payload.code),
  };
}

export function readVmEvalRequestBody(value: unknown): VmEvalRequestBody {
  const payload = ensureRecordBody(value);
  if (typeof payload.code !== "string" || payload.code.trim().length === 0) {
    throw new VmServerHttpError(400, "Eval request must include a non-empty string field `code`.");
  }

  return {
    code: payload.code,
    language: normalizeVmCellLanguage(payload.language),
    cellId: normalizeOptionalTrimmedString(payload.cellId, "Eval request field `cellId`"),
    previousCellId: normalizeOptionalTrimmedString(payload.previousCellId, "Eval request field `previousCellId`"),
  };
}

export function readVmCompletionRequestBody(value: unknown): VmCompletionRequestBody {
  const payload = ensureRecordBody(value);
  if (typeof payload.fragment !== "string") {
    throw new VmServerHttpError(400, "Completion request must include a string field `fragment`.");
  }

  return {
    fragment: payload.fragment,
    language: normalizeVmCellLanguage(payload.language),
  };
}

export function readVmFileRequestBody(value: unknown): VmFileRequestBody {
  const payload = ensureRecordBody(value);
  return {
    path: normalizeIsbPath(payload.path),
  };
}

export function normalizeNotebookDocument(value: unknown, expectedRelativePath: string): IsbNotebookDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VmServerHttpError(400, "Notebook payload must be an object.");
  }

  return {
    ...(value as IsbNotebookDocument),
    id: expectedRelativePath,
    path: expectedRelativePath,
  };
}

export function readVmSaveFileRequestBody(value: unknown, expectedRelativePath: string): VmSaveFileRequestBody {
  const payload = ensureRecordBody(value);
  return {
    notebook: normalizeNotebookDocument(payload.notebook, expectedRelativePath),
  };
}

export function readVmMoveFileRequestBody(value: unknown): VmMoveFileRequestBody {
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

export function readVmFsWriteRequestBody(value: unknown): VmFsWriteRequestBody {
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

export function readVmFsDeleteRequestBody(value: unknown): VmFsDeleteRequestBody {
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

// ─── Browser request bodies ───────────────────────────────────────────────────

export function readVmBrowserActionRequestBody(value: unknown): VmBrowserActionRequestBody {
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

export function readVmBrowserNavigateRequestBody(value: unknown): VmBrowserActionRequestBody {
  const payload = readVmBrowserActionRequestBody(value);
  if (!payload.url) {
    throw new VmServerHttpError(400, "Browser navigate request requires a non-empty `url`.");
  }
  return payload;
}

export function readVmExecutionStreamClientMessage(
  message: string | Buffer | ArrayBuffer | Uint8Array,
): VmExecutionStreamClientMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(decodeSocketMessage(message)) as unknown;
  } catch (error) {
    throw new VmServerHttpError(400, "Execution stream message must be valid JSON.", error);
  }

  const payload = ensureRecordBody(parsed);
  if (payload.type === "execute") {
    if (typeof payload.input !== "string" || payload.input.trim().length === 0) {
      throw new VmServerHttpError(400, "Execution message `input` must be a non-empty string.");
    }

    return {
      type: "execute",
      code: normalizeVmCode(payload.code),
      input: payload.input,
      language: normalizeVmCellLanguage(payload.language),
      cellId: normalizeOptionalTrimmedString(payload.cellId, "Execution message field `cellId`"),
      previousCellId: normalizeOptionalTrimmedString(payload.previousCellId, "Execution message field `previousCellId`"),
    };
  }

  if (payload.type === "cancel") {
    return {
      type: "cancel",
      taskId: normalizeOptionalTrimmedString(payload.taskId, "Execution message field `taskId`"),
    };
  }

  throw new VmServerHttpError(400, "Execution stream message type must be either `execute` or `cancel`.");
}

export function readVmBrowserStreamClientMessage(
  message: string | Buffer | ArrayBuffer | Uint8Array,
): VmBrowserStreamClientMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(decodeSocketMessage(message)) as unknown;
  } catch (error) {
    throw new VmServerHttpError(400, "Browser stream message must be valid JSON.", error);
  }

  const payload = ensureRecordBody(parsed);
  if (payload.type === "refresh-tabs") {
    return { type: "refresh-tabs" };
  }

  if ((payload.type === "pointer-down" || payload.type === "pointer-move" || payload.type === "pointer-up")
    && typeof payload.x === "number" && Number.isFinite(payload.x)
    && typeof payload.y === "number" && Number.isFinite(payload.y)) {
    return {
      type: payload.type,
      x: payload.x,
      y: payload.y,
    };
  }

  throw new VmServerHttpError(400, `Unsupported browser stream message type: ${String(payload.type)}`);
}

export function readVmInspectorStreamClientMessage(
  message: string | Buffer | ArrayBuffer | Uint8Array,
): VmInspectorStreamClientMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(decodeSocketMessage(message)) as unknown;
  } catch (error) {
    throw new VmServerHttpError(400, "Inspector stream message must be valid JSON.", error);
  }

  const payload = ensureRecordBody(parsed);
  if (payload.type === "inspect-node") {
    return {
      type: "inspect-node",
      handle: normalizeOptionalTrimmedString(payload.handle, "Inspector stream field `handle`")
        ?? (() => {
          throw new VmServerHttpError(400, "Inspector stream message `handle` must be a non-empty string.");
        })(),
    };
  }

  if (payload.type === "cancel-task") {
    return {
      type: "cancel-task",
      taskId: normalizeOptionalTrimmedString(payload.taskId, "Inspector stream field `taskId`")
        ?? (() => {
          throw new VmServerHttpError(400, "Inspector stream message `taskId` must be a non-empty string.");
        })(),
    };
  }

  throw new VmServerHttpError(400, "Inspector stream message type must be either `inspect-node` or `cancel-task`.");
}

export function readVmBrowserClickRequestBody(
  value: unknown,
): Required<Pick<VmBrowserActionRequestBody, "target" | "x" | "y">> {
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

export function readVmBrowserGestureRequestBody(value: unknown): VmBrowserGestureRequestBody {
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

export function readVmBrowserWheelRequestBody(value: unknown): VmBrowserWheelRequestBody {
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

export function readVmBrowserKeyboardRequestBody(value: unknown): VmBrowserKeyboardRequestBody {
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

export function readVmBrowserTextRequestBody(value: unknown): VmBrowserTextRequestBody {
  if (!value || typeof value !== "object") {
    throw new VmServerHttpError(400, "Browser text request body must be an object.");
  }

  const payload = value as Partial<VmBrowserTextRequestBody>;
  if (typeof payload.target !== "string" || payload.target.trim().length === 0) {
    throw new VmServerHttpError(400, "Browser text request requires a non-empty `target`.");
  }

  if (typeof payload.text !== "string") {
    throw new VmServerHttpError(400, "Browser text request requires a string `text`.");
  }

  return {
    target: payload.target,
    text: payload.text,
  };
}

export function readVmBrowserTabActivationRequestBody(value: unknown): VmBrowserTabActivationRequestBody {
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

export function readVmBrowserProfileProxySelection(
  value: unknown,
): VmBrowserProfileUpdateRequestBody["proxySelection"] {
  const payload = ensureRecordBody(value);
  const mode = payload.mode;
  if (mode !== "none" && mode !== "saved" && mode !== "preserve") {
    throw new VmServerHttpError(
      400,
      "Browser profile `proxySelection.mode` must be `none`, `saved`, or `preserve`.",
    );
  }

  if (mode === "saved") {
    return {
      mode,
      proxyId: normalizeRequiredTrimmedString(payload.proxyId, "Browser profile proxySelection.proxyId"),
    };
  }

  return { mode };
}

export function readVmBrowserProfileUpdateRequestBody(value: unknown): VmBrowserProfileUpdateRequestBody {
  const payload = ensureRecordBody(value);

  return {
    name: normalizeRequiredTrimmedString(payload.name, "Browser profile name"),
    proxySelection: readVmBrowserProfileProxySelection(payload.proxySelection),
    headless: normalizeRequiredBoolean(payload.headless, "Browser profile headless"),
    humanize: normalizeRequiredBoolean(payload.humanize, "Browser profile humanize"),
    userDataDir: normalizeOptionalTrimmedString(payload.userDataDir, "Browser profile userDataDir"),
    userAgent: normalizeOptionalTrimmedString(payload.userAgent, "Browser profile userAgent"),
    timezone: normalizeOptionalTrimmedString(payload.timezone, "Browser profile timezone"),
    locale: normalizeOptionalTrimmedString(payload.locale, "Browser profile locale"),
    searchEngine: normalizeOptionalTrimmedString(payload.searchEngine, "Browser profile searchEngine"),
    viewportWidth: normalizeOptionalViewportDimension(payload.viewportWidth, "Browser profile viewportWidth", { min: 1, max: 10000 }),
    viewportHeight: normalizeOptionalViewportDimension(payload.viewportHeight, "Browser profile viewportHeight", { min: 1, max: 10000 }),
  };
}

// ─── Package request bodies ───────────────────────────────────────────────────

export function readVmPackageCreateRequestBody(value: unknown): VmPackageCreateRequestBody {
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

  const defaultPrivilegeLevel = readOptionalVmPrivilegeLevel(
    payload.defaultPrivilegeLevel ?? payload.privilegeLevel,
    "defaultPrivilegeLevel",
  );
  const allowedPrivilegeLevels = readOptionalVmPrivilegeLevelArray(
    payload.allowedPrivilegeLevels,
    "allowedPrivilegeLevels",
  );
  const sandboxPolicyExtensions = readOptionalVmSandboxPolicyExtensions(
    payload.sandboxPolicyExtensions,
    "sandboxPolicyExtensions",
  );
  const allowHostPrivileged = readOptionalVmPolicyBoolean(payload.allowHostPrivileged, "allowHostPrivileged");
  const allowSandboxRw = readOptionalVmPolicyBoolean(payload.allowSandboxRw, "allowSandboxRw");
  const defaultSandboxRw = readOptionalVmPolicyBoolean(payload.defaultSandboxRw, "defaultSandboxRw");
  const hostDev = readOptionalVmPolicyBoolean(payload.hostDev, "hostDev");
  const hostProc = readOptionalVmPolicyBoolean(payload.hostProc, "hostProc");
  const hostSys = readOptionalVmPolicyBoolean(payload.hostSys, "hostSys");
  const shareNetwork = readOptionalVmPolicyBoolean(payload.shareNetwork, "shareNetwork");
  const unshareUser = readOptionalVmPolicyBoolean(payload.unshareUser, "unshareUser");
  const unshareIpc = readOptionalVmPolicyBoolean(payload.unshareIpc, "unshareIpc");
  const unsharePid = readOptionalVmPolicyBoolean(payload.unsharePid, "unsharePid");
  const unshareUts = readOptionalVmPolicyBoolean(payload.unshareUts, "unshareUts");
  const unshareCgroup = readOptionalVmPolicyBoolean(payload.unshareCgroup, "unshareCgroup");

  return {
    id: payload.id.trim(),
    name: typeof payload.name === "string" && payload.name.trim().length > 0 ? payload.name.trim() : undefined,
    description: typeof payload.description === "string" && payload.description.trim().length > 0
      ? payload.description.trim()
      : undefined,
    ...(allowHostPrivileged !== undefined ? { allowHostPrivileged } : {}),
    ...(allowSandboxRw !== undefined ? { allowSandboxRw } : {}),
    allowedPrivilegeLevels,
    ...(defaultSandboxRw !== undefined ? { defaultSandboxRw } : {}),
    defaultPrivilegeLevel,
    ...(hostDev !== undefined ? { hostDev } : {}),
    ...(hostProc !== undefined ? { hostProc } : {}),
    ...(hostSys !== undefined ? { hostSys } : {}),
    packages,
    ...(shareNetwork !== undefined ? { shareNetwork } : {}),
    ...(unshareUser !== undefined ? { unshareUser } : {}),
    ...(unshareIpc !== undefined ? { unshareIpc } : {}),
    ...(unsharePid !== undefined ? { unsharePid } : {}),
    ...(unshareUts !== undefined ? { unshareUts } : {}),
    ...(unshareCgroup !== undefined ? { unshareCgroup } : {}),
    sandboxPolicyExtensions,
  };
}

export function readVmPackageActionRequestBody(value: unknown): VmPackageActionRequestBody {
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

export function readVmPackageInstallRequestBody(value: unknown): VmPackageInstallRequestBody {
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

export function readVmPackagePrivilegeRequestBody(value: unknown): VmPackagePrivilegeRequestBody {
  if (!value || typeof value !== "object") {
    throw new VmServerHttpError(400, "Package privilege request body must be an object.");
  }

  const payload = value as Partial<VmPackagePrivilegeRequestBody>;
  const target = typeof payload.target === "string" && payload.target.trim().length > 0
    ? payload.target.trim()
    : undefined;
  const defaultPrivilegeLevel = readOptionalVmPrivilegeLevel(payload.defaultPrivilegeLevel, "defaultPrivilegeLevel");
  const allowedPrivilegeLevels = readOptionalVmPrivilegeLevelArray(
    payload.allowedPrivilegeLevels,
    "allowedPrivilegeLevels",
  );
  const sandboxPolicyExtensions = readOptionalVmSandboxPolicyExtensions(
    payload.sandboxPolicyExtensions,
    "sandboxPolicyExtensions",
  );
  const allowHostPrivileged = readOptionalVmPolicyBoolean(payload.allowHostPrivileged, "allowHostPrivileged");
  const allowSandboxRw = readOptionalVmPolicyBoolean(payload.allowSandboxRw, "allowSandboxRw");
  const defaultSandboxRw = readOptionalVmPolicyBoolean(payload.defaultSandboxRw, "defaultSandboxRw");
  const hostDev = readOptionalVmPolicyBoolean(payload.hostDev, "hostDev");
  const hostProc = readOptionalVmPolicyBoolean(payload.hostProc, "hostProc");
  const hostSys = readOptionalVmPolicyBoolean(payload.hostSys, "hostSys");
  const shareNetwork = readOptionalVmPolicyBoolean(payload.shareNetwork, "shareNetwork");
  const unshareUser = readOptionalVmPolicyBoolean(payload.unshareUser, "unshareUser");
  const unshareIpc = readOptionalVmPolicyBoolean(payload.unshareIpc, "unshareIpc");
  const unsharePid = readOptionalVmPolicyBoolean(payload.unsharePid, "unsharePid");
  const unshareUts = readOptionalVmPolicyBoolean(payload.unshareUts, "unshareUts");
  const unshareCgroup = readOptionalVmPolicyBoolean(payload.unshareCgroup, "unshareCgroup");

  if (!target) {
    throw new VmServerHttpError(400, "Package privilege request requires a non-empty `target`.");
  }

  if (
		allowHostPrivileged === undefined
		&& allowSandboxRw === undefined
		&& defaultSandboxRw === undefined
		&& hostDev === undefined
		&& hostProc === undefined
		&& hostSys === undefined
		&& shareNetwork === undefined
    && unshareUser === undefined
    && unshareIpc === undefined
    && unsharePid === undefined
    && unshareUts === undefined
    && unshareCgroup === undefined
		&& !defaultPrivilegeLevel
		&& (!allowedPrivilegeLevels || allowedPrivilegeLevels.length === 0)
		&& !sandboxPolicyExtensions
	) {
    throw new VmServerHttpError(
      400,
      "Package privilege request requires at least one flat policy boolean or a legacy privilege field.",
    );
  }

  return {
    target,
    ...(allowHostPrivileged !== undefined ? { allowHostPrivileged } : {}),
    ...(allowSandboxRw !== undefined ? { allowSandboxRw } : {}),
    ...(allowedPrivilegeLevels ? { allowedPrivilegeLevels } : {}),
    ...(defaultSandboxRw !== undefined ? { defaultSandboxRw } : {}),
    ...(defaultPrivilegeLevel ? { defaultPrivilegeLevel } : {}),
    ...(hostDev !== undefined ? { hostDev } : {}),
    ...(hostProc !== undefined ? { hostProc } : {}),
    ...(hostSys !== undefined ? { hostSys } : {}),
    ...(shareNetwork !== undefined ? { shareNetwork } : {}),
    ...(unshareUser !== undefined ? { unshareUser } : {}),
    ...(unshareIpc !== undefined ? { unshareIpc } : {}),
    ...(unsharePid !== undefined ? { unsharePid } : {}),
    ...(unshareUts !== undefined ? { unshareUts } : {}),
    ...(unshareCgroup !== undefined ? { unshareCgroup } : {}),
    ...(sandboxPolicyExtensions ? { sandboxPolicyExtensions } : {}),
  };
}

// ─── Terminal WebSocket messages ──────────────────────────────────────────────

export function readVmPackageTerminalClientMessage(
  message: string | Buffer | ArrayBuffer | Uint8Array,
): VmPackageTerminalClientMessage {
  let payload: unknown;
  try {
    payload = JSON.parse(decodeSocketMessage(message));
  } catch (error) {
    throw new VmServerHttpError(400, `Failed to decode terminal websocket message: ${buildErrorMessage(error)}`);
  }

  if (!payload || typeof payload !== "object") {
    throw new VmServerHttpError(400, "Terminal websocket message must be an object.");
  }

  const candidate = payload as Partial<VmPackageTerminalClientMessage> & { data?: unknown };
  if (candidate.type === "input") {
    if (typeof candidate.data !== "string") {
      throw new VmServerHttpError(400, "Terminal input message requires string `data`.");
    }

    return {
      type: "input",
      data: candidate.data,
    };
  }

  if (candidate.type === "resize") {
    return {
      type: "resize",
      cols: typeof candidate.cols === "number" && Number.isFinite(candidate.cols) ? candidate.cols : undefined,
      rows: typeof candidate.rows === "number" && Number.isFinite(candidate.rows) ? candidate.rows : undefined,
    };
  }

  throw new VmServerHttpError(400, "Unsupported terminal websocket message type.");
}
