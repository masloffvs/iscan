import { Buffer } from "node:buffer";
import { Script, createContext, type Context } from "node:vm";

import { OutputStack, type OutputEntity } from "../primitives";
import { RecoverableVmFileSystem } from "./recoverable-vm-fs";
import {
  buildPersistentAsyncCellSource,
  collectTopLevelBindingNamesFromSource,
} from "./recoverable-vm-transform";
import {
  createEmptyRecoverableVmSnapshot,
  loadRecoverableVmSnapshot,
  resolveRecoverableVmSnapshotFilePath,
  saveRecoverableVmSnapshot,
  type RecoverableVmSnapshot,
  type RecoverableVmSnapshotCell,
} from "./recoverable-vm-snapshot";

type ErrorWithCause = Error & { cause?: unknown };

type RecoverableVmOptions = {
  createHostContext: () => Record<string, unknown>;
};

export type RecoverableVmBindingSnapshot = {
  name: string;
  type: string;
  preview: string;
};

export type RecoverableVmInspectionSnapshot = {
  snapshotPath: string;
  prepared: boolean;
  snapshotCellCount: number;
  userBindingCount: number;
  userBindings: RecoverableVmBindingSnapshot[];
  rootEntries: string[];
};

export type RecoverableVmInspectorNodeKind =
  | "root"
  | "binding"
  | "helper"
  | "property"
  | "index"
  | "map-value"
  | "set-entry"
  | "prototype";

export type RecoverableVmInspectorNodeDescriptor = {
  enumerable: boolean;
  configurable: boolean;
  writable: boolean | null;
  getter: boolean;
  setter: boolean;
};

export type RecoverableVmInspectorNode = {
  handle: string;
  name: string;
  kind: RecoverableVmInspectorNodeKind;
  type: string;
  preview: string;
  constructorName: string | null;
  expandable: boolean;
  childCount: number | null;
  originCellId: string | null;
  descriptor: RecoverableVmInspectorNodeDescriptor | null;
};

export type RecoverableVmInspectorRootGroup = {
  id: string;
  title: string;
  subtitle: string | null;
  nodes: RecoverableVmInspectorNode[];
};

export type RecoverableVmInspectorNodePathEntry = {
  handle: string;
  label: string;
};

export type RecoverableVmInspectorNodeDetails = {
  node: RecoverableVmInspectorNode;
  path: RecoverableVmInspectorNodePathEntry[];
  children: RecoverableVmInspectorNode[];
};

export type RecoverableVmCompletionItem = {
  value: string;
  label?: string;
  detail?: string;
  kind: "command" | "module";
};

const RECOVERABLE_VM_COMPLETION_ITEMS: ReadonlyArray<{
  path: string;
  label: string;
  detail: string;
  kind: RecoverableVmCompletionItem["kind"];
}> = [
  {
    path: "$vm.fs",
    label: "$vm.fs",
    detail: "Current notebook VM filesystem",
    kind: "module",
  },
  {
    path: "$vm.fs.writeFileSync(\"/output.txt\", \"\")",
    label: "$vm.fs.writeFileSync(...)",
    detail: "Create or overwrite a text file in the current notebook VM filesystem",
    kind: "command",
  },
  {
    path: "$vm.fs.mkdirSync(\"/output\", { recursive: true })",
    label: "$vm.fs.mkdirSync(...)",
    detail: "Create a directory in the current notebook VM filesystem",
    kind: "command",
  },
  {
    path: "$vm.fs.existsSync(\"/output.txt\")",
    label: "$vm.fs.existsSync(...)",
    detail: "Check whether a file or directory exists in the current notebook VM filesystem",
    kind: "command",
  },
  {
    path: "$vm.fs.readdirSync(\"/\")",
    label: "$vm.fs.readdirSync(...)",
    detail: "List entries from the current notebook VM filesystem",
    kind: "command",
  },
];

const UNSUPPORTED_IMPORT_KINDS = new Set([
  "import-statement",
  "dynamic-import",
  "require-call",
  "require-resolve",
]);

const IDENTIFIER_CHARACTER_PATTERN = /[A-Za-z0-9_$]/u;
const INTERNAL_INSPECTOR_GLOBAL_NAMES = new Set(["$prev", "$last", "$notebook", "$isb", "_"]);
const INSPECTOR_HELPER_ROOTS = ["$prev", "$last", "$notebook", "$isb", "_"] as const;
const DEFAULT_INSPECTOR_CHILD_LIMIT = 80;
const PREVIEW_MAX_LENGTH = 160;

type RecoverableVmInspectorHandleRoot =
  | { kind: "global"; name: "globalThis" }
  | { kind: "binding" | "helper"; name: string };

type RecoverableVmInspectorHandleSegment =
  | { kind: "property"; key: string }
  | { kind: "index"; index: number }
  | { kind: "map-value"; index: number; keyPreview: string }
  | { kind: "set-entry"; index: number }
  | { kind: "prototype" };

type RecoverableVmInspectorHandle = {
  root: RecoverableVmInspectorHandleRoot;
  path: RecoverableVmInspectorHandleSegment[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncatePreview(value: string, maxLength: number = PREVIEW_MAX_LENGTH): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1)}…`
    : value;
}

function readInspectableTag(value: unknown): string {
  return Object.prototype.toString.call(value);
}

function isObjectLike(value: unknown): value is object | Function {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isDateLike(value: unknown): boolean {
  return readInspectableTag(value) === "[object Date]";
}

function isErrorLike(value: unknown): boolean {
  return readInspectableTag(value) === "[object Error]";
}

function isMapLike(value: unknown): boolean {
  return readInspectableTag(value) === "[object Map]";
}

function isSetLike(value: unknown): boolean {
  return readInspectableTag(value) === "[object Set]";
}

function readMapEntries(value: unknown): Array<[unknown, unknown]> {
  if (!isMapLike(value)) {
    return [];
  }

  try {
    return Array.from((value as Map<unknown, unknown>).entries());
  } catch {
    return [];
  }
}

function readSetEntries(value: unknown): unknown[] {
  if (!isSetLike(value)) {
    return [];
  }

  try {
    return Array.from((value as Set<unknown>).values());
  } catch {
    return [];
  }
}

function isPromiseLike(value: unknown): boolean {
  return isRecord(value) && typeof value.then === "function";
}

function readInspectableConstructorName(value: unknown): string | null {
  if (!isObjectLike(value)) {
    return null;
  }

  const constructorName = value.constructor?.name;
  return typeof constructorName === "string" && constructorName.trim().length > 0
    ? constructorName.trim()
    : null;
}

function readSafePrototype(value: unknown): object | null {
  if (!isObjectLike(value)) {
    return null;
  }

  try {
    return Object.getPrototypeOf(value);
  } catch {
    return null;
  }
}

function readOwnPropertyNames(value: unknown): string[] {
  if (!isObjectLike(value)) {
    return [];
  }

  try {
    return Object.getOwnPropertyNames(value);
  } catch {
    return [];
  }
}

function readOwnPropertyDescriptor(value: unknown, key: string): PropertyDescriptor | null {
  if (!isObjectLike(value)) {
    return null;
  }

  try {
    return Object.getOwnPropertyDescriptor(value, key) ?? null;
  } catch {
    return null;
  }
}

function isArrayIndexKey(value: string): boolean {
  return /^(0|[1-9]\d*)$/u.test(value);
}

function compareInspectorPropertyNames(left: string, right: string): number {
  const leftIsIndex = isArrayIndexKey(left);
  const rightIsIndex = isArrayIndexKey(right);

  if (leftIsIndex && rightIsIndex) {
    return Number(left) - Number(right);
  }

  if (leftIsIndex) {
    return -1;
  }

  if (rightIsIndex) {
    return 1;
  }

  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function readNumericPropertyIndex(value: string): number | null {
  if (!isArrayIndexKey(value)) {
    return null;
  }

  return Number(value);
}

function encodeInspectorHandle(handle: RecoverableVmInspectorHandle): string {
  return Buffer.from(JSON.stringify(handle), "utf8").toString("base64url");
}

function decodeInspectorHandle(rawHandle: string): RecoverableVmInspectorHandle {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(rawHandle, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new Error("Inspector handle is invalid.");
  }

  if (!isRecord(value) || !isRecord(value.root) || !Array.isArray(value.path)) {
    throw new Error("Inspector handle payload is invalid.");
  }

  const root = value.root;
  if ((root.kind !== "global" && root.kind !== "binding" && root.kind !== "helper") || typeof root.name !== "string") {
    throw new Error("Inspector handle root is invalid.");
  }

  if (root.kind === "global" && root.name !== "globalThis") {
    throw new Error("Inspector global root is invalid.");
  }

  const path = value.path.map((entry) => {
    if (!isRecord(entry) || typeof entry.kind !== "string") {
      throw new Error("Inspector handle path is invalid.");
    }

    if (entry.kind === "property" && typeof entry.key === "string") {
      return { kind: "property", key: entry.key } satisfies RecoverableVmInspectorHandleSegment;
    }

    if (entry.kind === "index" && typeof entry.index === "number") {
      return { kind: "index", index: entry.index } satisfies RecoverableVmInspectorHandleSegment;
    }

    if (entry.kind === "map-value" && typeof entry.index === "number" && typeof entry.keyPreview === "string") {
      return { kind: "map-value", index: entry.index, keyPreview: entry.keyPreview } satisfies RecoverableVmInspectorHandleSegment;
    }

    if (entry.kind === "set-entry" && typeof entry.index === "number") {
      return { kind: "set-entry", index: entry.index } satisfies RecoverableVmInspectorHandleSegment;
    }

    if (entry.kind === "prototype") {
      return { kind: "prototype" } satisfies RecoverableVmInspectorHandleSegment;
    }

    throw new Error("Inspector handle path entry is invalid.");
  });

  return {
    root: { kind: root.kind, name: root.name } as RecoverableVmInspectorHandleRoot,
    path,
  };
}

function createInspectorNodeDescriptor(descriptor: PropertyDescriptor | null): RecoverableVmInspectorNodeDescriptor | null {
  if (!descriptor) {
    return null;
  }

  return {
    enumerable: descriptor.enumerable ?? false,
    configurable: descriptor.configurable ?? false,
    writable: "value" in descriptor ? (descriptor.writable ?? false) : null,
    getter: typeof descriptor.get === "function",
    setter: typeof descriptor.set === "function",
  };
}

function describeInspectorAccessorPreview(descriptor: PropertyDescriptor | null): string | null {
  if (!descriptor || (typeof descriptor.get !== "function" && typeof descriptor.set !== "function")) {
    return null;
  }

  if (typeof descriptor.get === "function" && typeof descriptor.set === "function") {
    return "[Getter/Setter]";
  }

  if (typeof descriptor.get === "function") {
    return "[Getter]";
  }

  return "[Setter]";
}

function describeInspectableValueType(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (isDateLike(value)) {
    return "date";
  }

  if (isErrorLike(value)) {
    return "error";
  }

  if (isMapLike(value)) {
    return "map";
  }

  if (isSetLike(value)) {
    return "set";
  }

  if (typeof value === "function") {
    return "function";
  }

  if (isPromiseLike(value)) {
    return "promise";
  }

  if (isRecord(value)) {
    return readInspectableConstructorName(value)?.toLowerCase() || "object";
  }

  return typeof value;
}

function describeInspectableValuePreview(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return truncatePreview(JSON.stringify(value));
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "function") {
    return value.name ? `function ${value.name}(…)` : "function (anonymous)";
  }

  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }

  if (isDateLike(value)) {
    try {
      return new Date(value as string | number | Date).toISOString();
    } catch {
      return "Date";
    }
  }

  if (isErrorLike(value)) {
    const errorValue = value as { name?: unknown; message?: unknown };
    const name = typeof errorValue.name === "string" ? errorValue.name : "Error";
    const message = typeof errorValue.message === "string" ? errorValue.message : "";
    return truncatePreview(message.length > 0 ? `${name}: ${message}` : name);
  }

  if (isMapLike(value)) {
    try {
      return `Map(${Array.from((value as Map<unknown, unknown>).keys()).length})`;
    } catch {
      return "Map";
    }
  }

  if (isSetLike(value)) {
    try {
      return `Set(${Array.from((value as Set<unknown>).values()).length})`;
    } catch {
      return "Set";
    }
  }

  if (isPromiseLike(value)) {
    return "Promise { <pending> }";
  }

  if (isRecord(value)) {
    if (value.kind === "sql") {
      const rowCount = typeof value.rowCount === "number" ? value.rowCount : null;
      const tableCount = Array.isArray(value.tables) ? value.tables.length : 0;
      return rowCount !== null
        ? `sql result • ${rowCount} rows${tableCount > 0 ? ` • ${tableCount} tables` : ""}`
        : "sql result";
    }

      const constructorName = readInspectableConstructorName(value) || "Object";
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return `${constructorName} {}`;
    }

    return truncatePreview(`${constructorName} { ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""} }`);
  }

  try {
    return truncatePreview(JSON.stringify(value));
  } catch {
    return truncatePreview(String(value));
  }
}

function canExpandInspectableValue(value: unknown): boolean {
  if (!isObjectLike(value)) {
    return false;
  }

  if (isMapLike(value) || isSetLike(value)) {
    return true;
  }

  if (readOwnPropertyNames(value).length > 0) {
    return true;
  }

  return readSafePrototype(value) !== null;
}

function readInspectableChildCount(value: unknown): number | null {
  if (!canExpandInspectableValue(value)) {
    return null;
  }

  if (Array.isArray(value)) {
    const namedProperties = readOwnPropertyNames(value).filter((entry) => !isArrayIndexKey(entry) && entry !== "length").length;
    return value.length + namedProperties + (readSafePrototype(value) ? 1 : 0);
  }

  if (isMapLike(value)) {
    try {
      return Array.from((value as Map<unknown, unknown>).entries()).length + (readSafePrototype(value) ? 1 : 0);
    } catch {
      return readOwnPropertyNames(value).length + (readSafePrototype(value) ? 1 : 0);
    }
  }

  if (isSetLike(value)) {
    try {
      return Array.from((value as Set<unknown>).values()).length + (readSafePrototype(value) ? 1 : 0);
    } catch {
      return readOwnPropertyNames(value).length + (readSafePrototype(value) ? 1 : 0);
    }
  }

  return readOwnPropertyNames(value).length + (readSafePrototype(value) ? 1 : 0);
}

function getInspectorPathSegmentLabel(segment: RecoverableVmInspectorHandleSegment): string {
  if (segment.kind === "property") {
    return segment.key;
  }

  if (segment.kind === "index") {
    return `[${segment.index}]`;
  }

  if (segment.kind === "map-value") {
    return `map[${segment.index}]`;
  }

  if (segment.kind === "set-entry") {
    return `set[${segment.index}]`;
  }

  return "[[Prototype]]";
}

function readGlobalPropertyNames(context: Context): string[] {
  try {
    const script = new Script("Object.getOwnPropertyNames(globalThis)");
    const result = script.runInContext(context);
    return Array.isArray(result)
      ? result.filter((entry): entry is string => typeof entry === "string")
      : Object.getOwnPropertyNames(context as object);
  } catch {
    return Object.getOwnPropertyNames(context as object);
  }
}

function buildErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}

function isRetryableVmSyntaxError(error: unknown): boolean {
  return buildErrorMessage(error).startsWith("SyntaxError:");
}

function buildAsyncExpressionWrapper(source: string): string {
  return `(async () => (${source}\n))()`;
}

function buildAsyncBlockWrapper(source: string): string {
  return `(async () => {\n${source}\n})()`;
}

function findTopLevelControlKeyword(
  source: string,
  keywords: readonly string[],
): string | null {
  let curlyDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const nextChar = source[index + 1];
    if (!char) {
      continue;
    }

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inSingleQuote || inDoubleQuote || inTemplateString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (inSingleQuote && char === "'") {
        inSingleQuote = false;
        continue;
      }

      if (inDoubleQuote && char === '"') {
        inDoubleQuote = false;
        continue;
      }

      if (inTemplateString && char === "`") {
        inTemplateString = false;
      }
      continue;
    }

    if (char === "/" && nextChar === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }

    if (char === "`") {
      inTemplateString = true;
      continue;
    }

    if (char === "{") {
      curlyDepth += 1;
      continue;
    }

    if (char === "}") {
      curlyDepth = Math.max(0, curlyDepth - 1);
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      continue;
    }

    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === "(") {
      parenthesisDepth += 1;
      continue;
    }

    if (char === ")") {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      continue;
    }

    if (curlyDepth > 0 || bracketDepth > 0 || parenthesisDepth > 0) {
      continue;
    }

    for (const keyword of keywords) {
      if (!source.startsWith(keyword, index)) {
        continue;
      }

      const previousChar = source[index - 1] ?? "";
      const followingChar = source[index + keyword.length] ?? "";
      if (
        (previousChar.length > 0 && IDENTIFIER_CHARACTER_PATTERN.test(previousChar))
        || (followingChar.length > 0 && IDENTIFIER_CHARACTER_PATTERN.test(followingChar))
      ) {
        continue;
      }

      return keyword;
    }
  }

  return null;
}

function requiresAsyncWrapper(source: string): boolean {
  return findTopLevelControlKeyword(source, ["return", "await"]) !== null;
}

export class RecoverableVmError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = new.target.name;
    if (cause !== undefined) {
      (this as ErrorWithCause).cause = cause;
    }
  }
}

export class RecoverableVmNotPreparedError extends RecoverableVmError {
  constructor(snapshotPath: string) {
    super(
      `Recoverable VM "${snapshotPath}" is not prepared. Call vm.prepare() before vm.eval(...).`,
    );
  }
}

export class RecoverableVmUnsupportedSyntaxError extends RecoverableVmError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

export class RecoverableVm {
  readonly fs: RecoverableVmFileSystem;

  private readonly transpiler = new Bun.Transpiler({
    loader: "tsx",
    target: "bun",
  });

  private readonly relativeSnapshotPath: string;
  private executionContext: Context | null = null;
  private prepared = false;
  private snapshotReplayed = false;
  private suppressPersistence = false;
  private writeChain: Promise<void> = Promise.resolve();
  private snapshot: RecoverableVmSnapshot;
  private baselineGlobalKeys = new Set<string>();

  constructor(snapshotPath: string, private readonly options: RecoverableVmOptions) {
    const { relativePath } = resolveRecoverableVmSnapshotFilePath(snapshotPath);
    this.relativeSnapshotPath = relativePath;
    this.snapshot = createEmptyRecoverableVmSnapshot(relativePath);
    this.fs = new RecoverableVmFileSystem({
      onChange: () => {
        if (!this.prepared || this.suppressPersistence) {
          return;
        }

        void this.persistSnapshot();
      },
    });
  }

  getSnapshotPath(): string {
    return this.relativeSnapshotPath;
  }

  getSnapshotFilePath(): string {
    return resolveRecoverableVmSnapshotFilePath(this.relativeSnapshotPath).filePath;
  }

  isPrepared(): boolean {
    return this.prepared;
  }

  getOutputItems(): readonly OutputEntity[] {
    return this.readOutputStack()?.snapshot() ?? [];
  }

  subscribeOutput(listener: (items: readonly OutputEntity[]) => void): () => void {
    return this.readOutputStack()?.subscribe(listener) ?? (() => {});
  }

  async save(): Promise<void> {
    if (!this.prepared) {
      throw new RecoverableVmNotPreparedError(this.relativeSnapshotPath);
    }

    await this.persistSnapshot();
  }

  async prepare(options: { replaySnapshot?: boolean } = {}): Promise<void> {
    const shouldReplaySnapshot = options.replaySnapshot ?? true;
    if (this.prepared) {
      if (shouldReplaySnapshot) {
        await this.ensureExecutionState();
      }

      return;
    }

    this.snapshot = await loadRecoverableVmSnapshot(this.relativeSnapshotPath);
    this.suppressPersistence = true;
    try {
      this.fs.importSnapshot(this.snapshot.filesystem);
      this.executionContext = this.createExecutionContext({
        muteOutput: this.snapshot.cells.length > 0,
      });
      this.prepared = true;
      this.snapshotReplayed = this.snapshot.cells.length === 0;
      if (shouldReplaySnapshot) {
        await this.ensureExecutionState();
      }

      // Replay reconstructs lexical bindings, but the on-disk filesystem
      // snapshot remains authoritative for the prepared VM state.
      this.fs.importSnapshot(this.snapshot.filesystem);
    } catch (error) {
      this.executionContext = null;
      this.prepared = false;
      this.snapshotReplayed = false;
      throw new RecoverableVmError(
        `Failed to prepare recoverable VM "${this.relativeSnapshotPath}": ${buildErrorMessage(error)}`,
        error,
      );
    } finally {
      this.suppressPersistence = false;
    }
  }

  async eval(code: string): Promise<unknown> {
    if (!this.executionContext || !this.prepared) {
      throw new RecoverableVmNotPreparedError(this.relativeSnapshotPath);
    }

    const cell = this.createSnapshotCell(code);

    this.suppressPersistence = true;
    try {
      await this.ensureExecutionState();
      const result = await this.runTranspiledCell(cell.transpiled, cell.id);
      this.snapshot.cells.push(cell);
      await this.persistSnapshot();
      return result;
    } catch (error) {
      if (error instanceof RecoverableVmError) {
        throw error;
      }

      throw new RecoverableVmError(
        `Recoverable VM evaluation failed: ${buildErrorMessage(error)}`,
        error,
      );
    } finally {
      this.suppressPersistence = false;
    }
  }

  setGlobals(globals: Record<string, unknown>): void {
    if (!this.executionContext || !this.prepared) {
      throw new RecoverableVmNotPreparedError(this.relativeSnapshotPath);
    }

    Object.assign(this.executionContext as Record<string, unknown>, globals);
  }

  inspectState(options: { bindingLimit?: number; rootEntryLimit?: number } = {}): RecoverableVmInspectionSnapshot {
    const bindingLimit = Math.max(1, options.bindingLimit ?? 40);
    const rootEntryLimit = Math.max(1, options.rootEntryLimit ?? 12);
    const userBindingNames = this.listInspectableBindingNames();

    let rootEntries: string[] = [];
    try {
      rootEntries = this.fs.readdirSync("/")
        .slice()
        .sort((left, right) => left.localeCompare(right))
        .slice(0, rootEntryLimit);
    } catch {
      rootEntries = [];
    }

    return {
      snapshotPath: this.relativeSnapshotPath,
      prepared: this.prepared,
      snapshotCellCount: this.snapshot.cells.length,
      userBindingCount: userBindingNames.length,
      userBindings: userBindingNames
        .slice(0, bindingLimit)
        .map((name) => ({
          name,
          type: describeInspectableValueType(this.readBindingValue(name)),
          preview: describeInspectableValuePreview(this.readBindingValue(name)),
        })),
      rootEntries,
    };
  }

  listInspectorRootGroups(options: { bindingLimit?: number } = {}): RecoverableVmInspectorRootGroup[] {
    if (!this.executionContext || !this.prepared) {
      throw new RecoverableVmNotPreparedError(this.relativeSnapshotPath);
    }

    const bindingLimit = Math.max(1, options.bindingLimit ?? 64);

    return [
      {
        id: "globals",
        title: "Globals",
        subtitle: "Lowest layer. Raw JavaScript runtime roots.",
        nodes: [this.buildInspectorNode(
          this.createInspectorHandle("global", "globalThis"),
          {
            name: "globalThis",
            kind: "root",
            value: this.readBindingValue("globalThis"),
          },
        )],
      },
      {
        id: "bindings",
        title: "User Bindings",
        subtitle: "Top-level values initialized by notebook code.",
        nodes: this.listInspectableBindingNames()
          .slice(0, bindingLimit)
          .map((name) => this.buildInspectorNode(
            this.createInspectorHandle("binding", name),
            {
              name,
              kind: "binding",
              value: this.readBindingValue(name),
              originCellId: this.findBindingOriginCellId(name),
            },
          )),
      },
      {
        id: "helpers",
        title: "Notebook Helpers",
        subtitle: "Higher layer. Helpers injected by notebook semantics.",
        nodes: INSPECTOR_HELPER_ROOTS
          .filter((name) => name !== "$isb" && name !== "_")
          .map((name) => this.buildInspectorNode(
            this.createInspectorHandle("helper", name),
            {
              name,
              kind: "helper",
              value: this.readBindingValue(name),
            },
          )),
      },
    ].filter((group) => group.nodes.length > 0);
  }

  inspectNode(handle: string, options: { childLimit?: number } = {}): RecoverableVmInspectorNodeDetails {
    if (!this.executionContext || !this.prepared) {
      throw new RecoverableVmNotPreparedError(this.relativeSnapshotPath);
    }

    const childLimit = Math.max(1, options.childLimit ?? DEFAULT_INSPECTOR_CHILD_LIMIT);
    const inspectorHandle = decodeInspectorHandle(handle);
    const resolved = this.resolveInspectorHandle(inspectorHandle);

    return {
      node: resolved.node,
      path: this.buildInspectorNodePath(inspectorHandle),
      children: this.readInspectorChildren(inspectorHandle, resolved.value, resolved.originCellId, childLimit),
    };
  }

  private listInspectableBindingNames(): string[] {
    const bindingNames = new Set<string>();

    if (this.executionContext) {
      for (const name of readGlobalPropertyNames(this.executionContext)) {
        if (!this.baselineGlobalKeys.has(name) && !INTERNAL_INSPECTOR_GLOBAL_NAMES.has(name)) {
          bindingNames.add(name);
        }
      }
    }

    for (const cell of this.snapshot.cells) {
      for (const name of collectTopLevelBindingNamesFromSource(cell.source)) {
        if (!INTERNAL_INSPECTOR_GLOBAL_NAMES.has(name)) {
          bindingNames.add(name);
        }
      }
    }

    return [...bindingNames].sort((left, right) => left.localeCompare(right));
  }

  private readBindingValue(name: string): unknown {
    if (!this.executionContext) {
      return undefined;
    }

    try {
      const script = new Script(`(() => { try { return ${name}; } catch { return globalThis[${JSON.stringify(name)}]; } })()`);
      return script.runInContext(this.executionContext);
    } catch {
      return undefined;
    }
  }

  private findBindingOriginCellId(name: string): string | null {
    for (let index = this.snapshot.cells.length - 1; index >= 0; index -= 1) {
      const cell = this.snapshot.cells[index];
      if (collectTopLevelBindingNamesFromSource(cell.source).includes(name)) {
        return cell.id;
      }
    }

    return null;
  }

  private createInspectorHandle(
    rootKind: RecoverableVmInspectorHandleRoot["kind"],
    rootName: string,
    path: RecoverableVmInspectorHandleSegment[] = [],
  ): RecoverableVmInspectorHandle {
    return rootKind === "global"
      ? {
        root: { kind: "global", name: "globalThis" },
        path,
      }
      : {
        root: { kind: rootKind, name: rootName },
        path,
      };
  }

  private resolveInspectorHandle(handle: RecoverableVmInspectorHandle): {
    value: unknown;
    originCellId: string | null;
    node: RecoverableVmInspectorNode;
  } {
    let value = handle.root.kind === "global"
      ? this.readBindingValue("globalThis")
      : this.readBindingValue(handle.root.name);
    let descriptor: PropertyDescriptor | null = null;
    let name = handle.root.name;
    let kind: RecoverableVmInspectorNodeKind = handle.root.kind === "binding"
      ? "binding"
      : handle.root.kind === "helper"
        ? "helper"
        : "root";
    const originCellId = handle.root.kind === "binding"
      ? this.findBindingOriginCellId(handle.root.name)
      : null;

    for (const segment of handle.path) {
      descriptor = null;
      if (segment.kind === "property") {
        name = segment.key;
        kind = "property";
        if (isObjectLike(value)) {
          descriptor = readOwnPropertyDescriptor(value, segment.key);
          if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")) {
            value = descriptor.value;
          } else if (descriptor) {
            value = undefined;
          } else {
            try {
              value = Reflect.get(value as object, segment.key);
            } catch {
              value = undefined;
            }
          }
        } else {
          value = undefined;
        }
        continue;
      }

      if (segment.kind === "index") {
        name = `[${segment.index}]`;
        kind = "index";
        if (isObjectLike(value)) {
          descriptor = readOwnPropertyDescriptor(value, String(segment.index));
          if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")) {
            value = descriptor.value;
          } else if (descriptor) {
            value = undefined;
          } else {
            try {
              value = Reflect.get(value as object, String(segment.index));
            } catch {
              value = undefined;
            }
          }
        } else {
          value = undefined;
        }
        continue;
      }

      if (segment.kind === "map-value") {
        name = `[entry ${segment.index}]`;
        kind = "map-value";
        value = readMapEntries(value)[segment.index]?.[1];
        continue;
      }

      if (segment.kind === "set-entry") {
        name = `[set ${segment.index}]`;
        kind = "set-entry";
        value = readSetEntries(value)[segment.index];
        continue;
      }

      name = "[[Prototype]]";
      kind = "prototype";
      value = isObjectLike(value) ? readSafePrototype(value) : null;
    }

    return {
      value,
      originCellId,
      node: this.buildInspectorNode(handle, {
        name,
        kind,
        value,
        descriptor,
        originCellId,
      }),
    };
  }

  private readInspectorChildren(
    handle: RecoverableVmInspectorHandle,
    value: unknown,
    originCellId: string | null,
    childLimit: number,
  ): RecoverableVmInspectorNode[] {
    if (isMapLike(value)) {
      return readMapEntries(value)
        .slice(0, childLimit)
        .map(([key, childValue], index) => this.buildInspectorNode(
          this.createInspectorHandle(handle.root.kind, handle.root.name, [
            ...handle.path,
            { kind: "map-value", index, keyPreview: describeInspectableValuePreview(key) },
          ]),
          {
            name: `[${truncatePreview(describeInspectableValuePreview(key), 42)}]`,
            kind: "map-value",
            value: childValue,
            originCellId,
          },
        ));
    }

    if (isSetLike(value)) {
      return readSetEntries(value)
        .slice(0, childLimit)
        .map((childValue, index) => this.buildInspectorNode(
          this.createInspectorHandle(handle.root.kind, handle.root.name, [
            ...handle.path,
            { kind: "set-entry", index },
          ]),
          {
            name: `[${index}]`,
            kind: "set-entry",
            value: childValue,
            originCellId,
          },
        ));
    }

    if (!isObjectLike(value)) {
      return [];
    }

    const children = readOwnPropertyNames(value)
      .sort(compareInspectorPropertyNames)
      .slice(0, childLimit)
      .map((propertyName) => {
        const descriptor = readOwnPropertyDescriptor(value, propertyName);
        const propertyValue = descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
          ? descriptor.value
          : undefined;
        const index = readNumericPropertyIndex(propertyName);
        const segment = index !== null
          ? { kind: "index", index } satisfies RecoverableVmInspectorHandleSegment
          : { kind: "property", key: propertyName } satisfies RecoverableVmInspectorHandleSegment;

        return this.buildInspectorNode(
          this.createInspectorHandle(handle.root.kind, handle.root.name, [...handle.path, segment]),
          {
            name: index !== null ? `[${index}]` : propertyName,
            kind: index !== null ? "index" : "property",
            value: propertyValue,
            descriptor,
            originCellId,
          },
        );
      });

    const prototype = readSafePrototype(value);
    if (!prototype) {
      return children;
    }

    return [
      ...children,
      this.buildInspectorNode(
        this.createInspectorHandle(handle.root.kind, handle.root.name, [...handle.path, { kind: "prototype" }]),
        {
          name: "[[Prototype]]",
          kind: "prototype",
          value: prototype,
          originCellId,
        },
      ),
    ];
  }

  private buildInspectorNodePath(handle: RecoverableVmInspectorHandle): RecoverableVmInspectorNodePathEntry[] {
    const path: RecoverableVmInspectorNodePathEntry[] = [{
      handle: encodeInspectorHandle(this.createInspectorHandle(handle.root.kind, handle.root.name)),
      label: handle.root.name,
    }];

    let nextPath: RecoverableVmInspectorHandleSegment[] = [];
    for (const segment of handle.path) {
      nextPath = [...nextPath, segment];
      path.push({
        handle: encodeInspectorHandle(this.createInspectorHandle(handle.root.kind, handle.root.name, nextPath)),
        label: getInspectorPathSegmentLabel(segment),
      });
    }

    return path;
  }

  private buildInspectorNode(
    handle: RecoverableVmInspectorHandle,
    input: {
      name: string;
      kind: RecoverableVmInspectorNodeKind;
      value: unknown;
      descriptor?: PropertyDescriptor | null;
      originCellId?: string | null;
    },
  ): RecoverableVmInspectorNode {
    const descriptor = input.descriptor ?? null;
    const isAccessor = Boolean(descriptor && !Object.prototype.hasOwnProperty.call(descriptor, "value"));

    return {
      handle: encodeInspectorHandle(handle),
      name: input.name,
      kind: input.kind,
      type: isAccessor ? "accessor" : describeInspectableValueType(input.value),
      preview: isAccessor && descriptor ? describeInspectorAccessorPreview(descriptor) ?? "[Accessor]" : describeInspectableValuePreview(input.value),
      constructorName: isAccessor ? null : readInspectableConstructorName(input.value),
      expandable: !isAccessor && canExpandInspectableValue(input.value),
      childCount: isAccessor ? null : readInspectableChildCount(input.value),
      descriptor: createInspectorNodeDescriptor(descriptor),
      originCellId: input.originCellId ?? null,
    };
  }

  private createExecutionContext(options: { muteOutput?: boolean } = {}): Context {
    const hostContext = { ...this.options.createHostContext() };
    if (options.muteOutput && "output" in hostContext) {
      hostContext.output = new OutputStack();
    }

    const context = createContext({
      AbortController,
      AbortSignal,
      Buffer,
      FormData,
      Headers,
      Request,
      Response,
      TextDecoder,
      TextEncoder,
      URL,
      URLSearchParams,
      clearImmediate,
      clearInterval,
      clearTimeout,
      console,
      crypto,
      fetch,
      fs: this.fs,
      performance,
      queueMicrotask,
      setImmediate,
      setInterval,
      setTimeout,
      structuredClone,
      vfs: this.fs,
      ...hostContext,
      $vm: {
        fs: this.fs,
        vfs: this.fs,
        snapshotPath: this.relativeSnapshotPath,
      },
    });

    this.baselineGlobalKeys = new Set(readGlobalPropertyNames(context));
    return context;
  }

  private readOutputStack(): OutputStack | null {
    if (!this.executionContext || !this.prepared) {
      return null;
    }

    const output = (this.executionContext as Record<string, unknown>).output;
    return output instanceof OutputStack ? output : null;
  }

  private async ensureExecutionState(): Promise<void> {
    if (!this.executionContext || !this.prepared || this.snapshotReplayed) {
      return;
    }

    const previousSuppressPersistence = this.suppressPersistence;
    this.suppressPersistence = true;
    try {
      await this.replaySnapshot();
      this.snapshotReplayed = true;

      // The serialized filesystem snapshot remains authoritative for the
      // prepared VM state even after replay reconstructs lexical bindings.
      this.fs.importSnapshot(this.snapshot.filesystem);
    } catch (error) {
      this.executionContext = this.createExecutionContext({
        muteOutput: this.snapshot.cells.length > 0,
      });
      this.fs.importSnapshot(this.snapshot.filesystem);
      this.snapshotReplayed = this.snapshot.cells.length === 0;
      throw new RecoverableVmError(
        `Failed to replay recoverable VM snapshot "${this.relativeSnapshotPath}": ${buildErrorMessage(error)}`,
        error,
      );
    } finally {
      this.suppressPersistence = previousSuppressPersistence;
    }
  }

  private async replaySnapshot(): Promise<void> {
    for (const cell of this.snapshot.cells) {
      await this.runTranspiledCell(cell.transpiled, cell.id);
    }
  }

  private createSnapshotCell(source: string): RecoverableVmSnapshotCell {
    const trimmedSource = source.trim();
    if (trimmedSource.length === 0) {
      throw new RecoverableVmError("Recoverable VM code cannot be empty.");
    }

    return {
      id: `cell:${this.snapshot.cells.length + 1}`,
      source,
      transpiled: this.transpileCellSource(source),
      createdAt: Date.now(),
    };
  }

  private transpileCellSource(source: string): string {
    const useAsyncWrapper = requiresAsyncWrapper(source);
    if (!useAsyncWrapper) {
      this.validateCellSource(source);
      return this.transpiler.transformSync(source, "tsx");
    }

    const asyncPersistentSource = buildPersistentAsyncCellSource(source);
    this.validateCellSource(asyncPersistentSource);
    return this.transpiler.transformSync(asyncPersistentSource, "tsx");
  }

  private validateCellSource(source: string): void {
    const scanResult = this.transpiler.scan(source);
    if (scanResult.exports.length > 0) {
      throw new RecoverableVmUnsupportedSyntaxError(
        "Recoverable VM does not support export syntax yet.",
      );
    }

    const moduleImport = scanResult.imports.find((entry) =>
      UNSUPPORTED_IMPORT_KINDS.has(entry.kind),
    );
    if (moduleImport) {
      throw new RecoverableVmUnsupportedSyntaxError(
        `Recoverable VM does not support module loading yet (${moduleImport.kind}: ${moduleImport.path}).`,
      );
    }
  }

  private async runTranspiledCell(
    transpiled: string,
    cellId: string,
  ): Promise<unknown> {
    if (!this.executionContext) {
      throw new RecoverableVmNotPreparedError(this.relativeSnapshotPath);
    }

    try {
      const script = new Script(transpiled, {
        filename: `recoverable-vm://${this.relativeSnapshotPath}#${cellId}`,
      });
      return await Promise.resolve(script.runInContext(this.executionContext));
    } catch (error) {
      if (isRetryableVmSyntaxError(error) && requiresAsyncWrapper(transpiled)) {
        return await this.runWrappedAsyncCell(transpiled, cellId, error);
      }

      throw error;
    }
  }

  private async runWrappedAsyncCell(
    transpiled: string,
    cellId: string,
    directError: unknown,
  ): Promise<unknown> {
    if (!this.executionContext) {
      throw new RecoverableVmNotPreparedError(this.relativeSnapshotPath);
    }

    const wrappedSources = [
      buildAsyncExpressionWrapper(transpiled),
      buildAsyncBlockWrapper(transpiled),
    ];

    let lastError: unknown = directError;
    for (const wrappedSource of wrappedSources) {
      try {
        const script = new Script(wrappedSource, {
          filename: `recoverable-vm://${this.relativeSnapshotPath}#${cellId}:async`,
        });
        return await Promise.resolve(script.runInContext(this.executionContext));
      } catch (error) {
        lastError = error;
      }
    }

    throw new RecoverableVmUnsupportedSyntaxError(
      "Recoverable VM could not execute this cell with top-level return/await semantics.",
      lastError,
    );
  }

  private async persistSnapshot(): Promise<void> {
    const nextSnapshot: RecoverableVmSnapshot = {
      ...this.snapshot,
      savedAt: Date.now(),
      cells: [...this.snapshot.cells],
      filesystem: this.fs.snapshot(),
    };
    this.snapshot = nextSnapshot;
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await saveRecoverableVmSnapshot(nextSnapshot);
      });

    await this.writeChain;
  }
}

export class RecoverableVmManager {
  constructor(
    private readonly createRecoverableVm: (snapshotPath: string) => RecoverableVm,
  ) {}

  createOrLoad(snapshotPath: string): RecoverableVm {
    return this.createRecoverableVm(snapshotPath);
  }
}

export function getRecoverableVmCompletionItems(inputValue: string): RecoverableVmCompletionItem[] {
  const trimmedStart = inputValue.trimStart();
  if (!trimmedStart.startsWith("$vm")) {
    return [];
  }

  const vmIndex = inputValue.indexOf("$vm");
  if (vmIndex < 0) {
    return [];
  }

  const suffix = inputValue.slice(vmIndex + 3);
  const completionBase = inputValue.slice(0, vmIndex);

  return RECOVERABLE_VM_COMPLETION_ITEMS
    .filter((entry) => suffix.length === 0 || entry.path.startsWith(`$vm${suffix}`))
    .map((entry) => ({
      value: `${completionBase}${entry.path}`,
      label: entry.label,
      detail: entry.detail,
      kind: entry.kind,
    }));
}