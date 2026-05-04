import { Buffer } from "node:buffer";
import { Script, createContext, type Context } from "node:vm";

import { OutputStack } from "../primitives";
import { RecoverableVmFileSystem } from "./recoverable-vm-fs";
import { buildPersistentAsyncCellSource } from "./recoverable-vm-transform";
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

  private createExecutionContext(options: { muteOutput?: boolean } = {}): Context {
    const hostContext = { ...this.options.createHostContext() };
    if (options.muteOutput && "output" in hostContext) {
      hostContext.output = new OutputStack();
    }

    return createContext({
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