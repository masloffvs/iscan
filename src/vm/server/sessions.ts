import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, posix as path, resolve } from "node:path";
import { runWithExecutionLogSink, type ExecutionLogStream } from "../../execution-log";
import { logger, runWithLoggerOutputSink } from "../../logger";
import { buildNotebookRuntimeTypeSource } from "../../notebook-lib-definitions";
import { buildNotebookCommandRuntimeTypeSource } from "../../notebook-command-runtime-types";
import {
  type ModuleRuntime,
  loadRecoverableVmSnapshot,
  saveRecoverableVmSnapshot,
  resolveRecoverableVmSnapshotFilePath,
} from "../../modules";
import type { RecoverableVmInspectionSnapshot } from "../../modules/recoverable-vm";
import {
  ensureStorageKit,
  executeSql,
  getSqlNotebookCompletionItems,
  readSchemaSnapshot,
} from "../../modules/sql/console";
import { generateVmCode } from "../../primitives";
import { normalizeOutputEntities, renderOutputEntities } from "../../primitives";
import {
  createIsbSnapshotTemplatePath,
  createEmptyIsbFile,
  deleteIsbFile,
  moveIsbFile,
  normalizeIsbRelativePath,
  readIsbFile,
  rebaseRecoverableVmSnapshot,
  resolveIsbFilePath,
  writeIsbFile,
  type IsbFile,
  type IsbNotebookDocument,
} from "../isb";
import { VmServerHttpError, buildErrorMessage } from "./http";
import { buildSqlNotebookOutput } from "./sql-output";
import { createSnapshotPath, serializeVmResult } from "./utils";
import type { OutputEntity } from "../../primitives";
import type { ModuleDefinition } from "../../modules/module";
import type {
  JsonValue,
  VmCellLanguage,
  VmExecutionStreamCancelAckEvent,
  VmExecutionStreamServerMessage,
  VmExecutionTaskLifecycleState,
  VmExecutionTaskSnapshot,
  VmNotebookCellRuntimeResult,
  VmServerSession,
} from "./types";

const MAX_VM_CODE_GENERATION_ATTEMPTS = 64;
const INSPECTOR_VALUE_PREVIEW_MAX_LENGTH = 180;
const MAX_RETAINED_EXECUTION_TASKS = 24;
const MAX_RETAINED_EXECUTION_TASK_LOG_LINES = 240;
const EXECUTION_TASK_LOG_LINE_MAX_LENGTH = 480;
const EXECUTION_TASK_OUTPUT_RENDER_WIDTH = 120;

type VmExecutionTaskListener = (event: VmExecutionStreamServerMessage) => void;

type VmExecutionTaskInternal = {
  taskId: string;
  sessionCode: string;
  input: string;
  language: VmCellLanguage;
  cellId: string | null;
  previousCellId: string | null;
  status: VmExecutionTaskLifecycleState;
  queuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  sourcePreview: string;
  sourceLineCount: number;
  cancelRequested: boolean;
  logs: string[];
  logLineCount: number;
  pendingStdoutChunk: string;
  pendingStderrChunk: string;
  result: unknown;
  serializedResult: JsonValue | null;
  errorMessage: string | null;
  completion: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

class VmExecutionCancelledError extends Error {
  constructor(readonly taskId: string, message = "Execution cancelled.") {
    super(message);
    this.name = "VmExecutionCancelledError";
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function truncateInspectorText(value: string, maxLength: number = INSPECTOR_VALUE_PREVIEW_MAX_LENGTH): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1)}…`
    : value;
}

function buildInspectorSourcePreview(source: string): { preview: string; lineCount: number } {
  const lines = source.split(/\r?\n/u);
  return {
    preview: truncateInspectorText(
      lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(" ") || "<empty>",
    ),
    lineCount: lines.length,
  };
}

function formatInspectorValuePreview(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return truncateInspectorText(JSON.stringify(value));
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }

  if (typeof value === "function") {
    return value.name ? `function ${value.name}(…)` : "function (anonymous)";
  }

  if (value instanceof Error) {
    return truncateInspectorText(`${value.name}: ${value.message}`);
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === "sql" && typeof record.rowCount === "number") {
      return `sql result • ${record.rowCount} rows`;
    }

    const constructorName = (value as { constructor?: { name?: string } }).constructor?.name?.trim() || "Object";
    const keys = Object.keys(record);
    return truncateInspectorText(
      keys.length > 0
        ? `${constructorName} { ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""} }`
        : `${constructorName} {}`,
    );
  }

  try {
    return truncateInspectorText(JSON.stringify(value));
  } catch {
    return truncateInspectorText(String(value));
  }
}

function formatInspectorMegabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function readInspectorMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rssBytes: usage.rss,
    heapTotalBytes: usage.heapTotal,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
    rssMb: formatInspectorMegabytes(usage.rss),
    heapTotalMb: formatInspectorMegabytes(usage.heapTotal),
    heapUsedMb: formatInspectorMegabytes(usage.heapUsed),
    externalMb: formatInspectorMegabytes(usage.external),
    arrayBuffersMb: formatInspectorMegabytes(usage.arrayBuffers),
  };
}

function readNotebookTypeOverlaySource(
  modules: readonly ModuleDefinition<unknown, unknown, object>[],
): string {
  const uniqueOverlayPaths = [...new Set(modules
    .map((moduleDefinition) => moduleDefinition.notebookTypeOverlay?.path?.trim())
    .filter((overlayPath): overlayPath is string => Boolean(overlayPath)))];

  return uniqueOverlayPaths
    .map((overlayPath) => {
      if (!overlayPath.endsWith(".h.ts")) {
        throw new Error(`Notebook type overlay path must point to a *.h.ts file: ${overlayPath}`);
      }

      const source = readFileSync(resolve(process.cwd(), overlayPath), "utf8").trim();
      return source.length > 0
        ? `// notebook type overlay: ${overlayPath}\n${source}`
        : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

type NotebookSqlTableResult = {
  title?: string;
  columns: Array<{ key: string; header: string }>;
  rows: Record<string, unknown>[];
};

type NotebookSqlCellResult = {
  kind: "sql";
  summary: string | null;
  text: string[];
  tables: NotebookSqlTableResult[];
  firstTable: NotebookSqlTableResult | null;
  rows: Record<string, unknown>[];
  rowCount: number;
  entities: OutputEntity[];
};

function isExecutableNotebookCell(cell: IsbNotebookDocument["cells"][number] | undefined): boolean {
  return Boolean(cell && cell.kind !== "markdown");
}

function buildNotebookSqlCellResult(result: unknown): NotebookSqlCellResult {
  const entities = normalizeOutputEntities(result) ?? [];
  const text = entities
    .filter((entity) => entity.kind === "text")
    .flatMap((entity) => entity.lines);
  const tables = entities
    .filter((entity) => entity.kind === "table")
    .map((entity) => ({
      title: entity.title,
      columns: entity.columns.map((column) => ({ key: column.key, header: column.header })),
      rows: entity.rows.map((row) => ({ ...row })),
    }));
  const firstTable = tables[0] ?? null;

  return {
    kind: "sql",
    summary: text[0] ?? null,
    text,
    tables,
    firstTable,
    rows: firstTable?.rows ?? [],
    rowCount: firstTable?.rows.length ?? 0,
    entities,
  };
}

function createNotebookRuntimeValue(language: VmCellLanguage, result: unknown): unknown {
  return language === "sql"
    ? buildNotebookSqlCellResult(result)
    : result;
}

export class VmServerSessions {
  private readonly sessions = new Map<string, VmServerSession>();
  private readonly sessionLoads = new Map<string, Promise<VmServerSession>>();
  private readonly sessionCodesByPath = new Map<string, string>();
  private readonly executionTasks = new Map<string, VmExecutionTaskInternal>();
  private readonly executionTaskListeners = new Map<string, Set<VmExecutionTaskListener>>();
  private readonly queuedExecutionTaskIds: string[] = [];
  private readonly completedExecutionTaskIds: string[] = [];
  private activeExecutionTaskId: string | null = null;
  private isProcessingExecutionQueue = false;

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

  getNotebookTypeSource(): string {
    const overlaySource = readNotebookTypeOverlaySource(this.runtime.listModules());
    return [
      buildNotebookRuntimeTypeSource(),
      buildNotebookCommandRuntimeTypeSource(this.runtime.listPaletteCommands()),
      ...(overlaySource ? [overlaySource] : []),
    ].join("\n\n");
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

  private getPreviousNotebookCellId(
    session: VmServerSession,
    currentCellId: string,
  ): string | null {
    const cells = session.notebook?.cells ?? [];
    const currentIndex = cells.findIndex((cell) => cell.id === currentCellId);
    if (currentIndex <= 0) {
      return null;
    }

    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      const candidate = cells[index];
      if (isExecutableNotebookCell(candidate)) {
        return candidate.id;
      }
    }

    return null;
  }

  private buildNotebookGlobals(
    session: VmServerSession,
    options: { cellId?: string; previousCellId?: string } = {},
  ): Record<string, unknown> {
    const currentCellId = options.cellId ?? null;
    const previousCellId = options.previousCellId
      ?? (currentCellId ? this.getPreviousNotebookCellId(session, currentCellId) : null);
    const previousResult = previousCellId
      ? session.notebookCellResults.get(previousCellId)?.value
      : undefined;
    const lastCellId = session.lastNotebookCellId;
    const lastResult = lastCellId
      ? session.notebookCellResults.get(lastCellId)?.value
      : undefined;

    const notebook = {
      currentCellId,
      previousCellId,
      lastCellId,
      prev: previousResult,
      last: lastResult,
      get: (cellId: string) => session.notebookCellResults.get(cellId)?.value,
      has: (cellId: string) => session.notebookCellResults.has(cellId),
      keys: () => [...session.notebookCellResults.keys()],
    };

    return {
      $prev: previousResult,
      $last: lastResult,
      _: previousResult,
      $notebook: notebook,
      $isb: notebook,
    };
  }

  private recordNotebookCellResult(
    session: VmServerSession,
    cellId: string | undefined,
    language: VmCellLanguage,
    result: unknown,
  ): void {
    if (!cellId) {
      return;
    }

    const entry: VmNotebookCellRuntimeResult = {
      cellId,
      language,
      value: createNotebookRuntimeValue(language, result),
      executedAt: Date.now(),
    };
    session.notebookCellResults.set(cellId, entry);
    session.lastNotebookCellId = cellId;
  }

  private clearNotebookCellResult(session: VmServerSession, cellId: string | undefined): void {
    if (!cellId) {
      return;
    }

    session.notebookCellResults.delete(cellId);
    if (session.lastNotebookCellId !== cellId) {
      return;
    }

    let lastEntry: VmNotebookCellRuntimeResult | null = null;
    for (const entry of session.notebookCellResults.values()) {
      if (!lastEntry || entry.executedAt > lastEntry.executedAt) {
        lastEntry = entry;
      }
    }

    session.lastNotebookCellId = lastEntry?.cellId ?? null;
  }

  private createInspectorSnapshot(
    session: VmServerSession,
    vmState: RecoverableVmInspectionSnapshot,
  ) {
    return {
      code: session.code,
      relativePath: session.relativePath ?? null,
      notebookTitle: session.notebook?.title ?? null,
      notebookCellCount: session.notebook?.cells.length ?? 0,
      inspectedAt: new Date().toISOString(),
      snapshotPath: session.vm.getSnapshotPath(),
      activeEvaluation: session.activeEvaluation
        ? {
          taskId: session.activeEvaluation.taskId,
          language: session.activeEvaluation.language,
          cellId: session.activeEvaluation.cellId,
          previousCellId: session.activeEvaluation.previousCellId,
          startedAt: new Date(session.activeEvaluation.startedAt).toISOString(),
          durationMs: Math.max(0, Date.now() - session.activeEvaluation.startedAt),
          sourcePreview: session.activeEvaluation.sourcePreview,
          sourceLineCount: session.activeEvaluation.sourceLineCount,
        }
        : null,
      memoryUsage: readInspectorMemoryUsage(),
      vm: {
        prepared: vmState.prepared,
        persistedCellCount: vmState.snapshotCellCount,
        userBindingCount: vmState.userBindingCount,
        userBindings: vmState.userBindings,
        rootEntries: vmState.rootEntries,
      },
      execution: {
        activeTaskId: this.activeExecutionTaskId,
        queueLength: this.queuedExecutionTaskIds.length + (this.activeExecutionTaskId ? 1 : 0),
        tasks: this.listExecutionTaskSnapshots(session.code),
      },
      recentCellResults: [...session.notebookCellResults.values()]
        .sort((left, right) => right.executedAt - left.executedAt)
        .slice(0, 12)
        .map((entry) => ({
          cellId: entry.cellId,
          language: entry.language,
          executedAt: new Date(entry.executedAt).toISOString(),
          preview: formatInspectorValuePreview(entry.value),
        })),
      runtimeKits: this.runtime.listKits().map((kit) => ({
        id: kit.id,
        name: kit.info.name,
        category: kit.info.category ?? null,
        active: kit.isActive(),
      })),
      backgroundWorkers: this.runtime.getBackgroundWorkerSnapshots().map((snapshot) => ({
        id: snapshot.id,
        name: snapshot.name,
        relativeScriptPath: snapshot.relativeScriptPath,
        status: snapshot.status,
        pid: snapshot.pid,
        startedAt: snapshot.startedAt,
        updatedAt: snapshot.updatedAt,
        lastEvent: snapshot.lastEvent ?? null,
        lastLog: snapshot.lastLog ?? null,
        lastLogLevel: snapshot.lastLogLevel ?? null,
        uptimeSeconds: snapshot.lastMetrics?.uptimeSeconds ?? null,
        memoryUsage: snapshot.lastMetrics?.memoryUsage
          ? {
            rssMb: snapshot.lastMetrics.memoryUsage.rssMb,
            heapTotalMb: snapshot.lastMetrics.memoryUsage.heapTotalMb,
            heapUsedMb: snapshot.lastMetrics.memoryUsage.heapUsedMb,
            externalMb: snapshot.lastMetrics.memoryUsage.externalMb,
            arrayBuffersMb: snapshot.lastMetrics.memoryUsage.arrayBuffersMb,
          }
          : null,
      })),
    };
  }

  private async evaluateWithLanguage(
    code: string,
    input: string,
    language: VmCellLanguage,
    options: { cellId?: string; previousCellId?: string } = {},
    execution: { taskId?: string; shouldCancel?: () => boolean } = {},
  ): Promise<unknown> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const sourcePreview = buildInspectorSourcePreview(input);
      this.throwIfExecutionCancelled(execution);
      session.activeEvaluation = {
        taskId: execution.taskId ?? null,
        language,
        cellId: options.cellId ?? null,
        previousCellId: options.previousCellId ?? null,
        startedAt: Date.now(),
        sourcePreview: sourcePreview.preview,
        sourceLineCount: sourcePreview.lineCount,
      };

      if (language === "javascript") {
        session.vm.setGlobals(this.buildNotebookGlobals(session, options));
      }

      try {
        this.throwIfExecutionCancelled(execution);
        const result = language === "sql"
          ? await this.evaluateSqlCell(input)
          : await session.vm.eval(input);
        this.throwIfExecutionCancelled(execution);
        this.recordNotebookCellResult(session, options.cellId, language, result);
        await this.persistBoundFileSession(session);
        this.throwIfExecutionCancelled(execution);
        return result;
      } catch (error) {
        this.clearNotebookCellResult(session, options.cellId);
        throw error;
      } finally {
        session.activeEvaluation = null;
      }
    });
  }

  async evaluate(
    code: string,
    input: string,
    language: VmCellLanguage = "javascript",
    options: { cellId?: string; previousCellId?: string } = {},
  ): Promise<unknown> {
    const task = await this.startExecutionTask(code, input, language, options);
    return await task.completion;
  }

  async startExecutionTask(
    code: string,
    input: string,
    language: VmCellLanguage = "javascript",
    options: { cellId?: string; previousCellId?: string } = {},
    listener?: VmExecutionTaskListener,
  ): Promise<{ taskId: string; completion: Promise<unknown>; unsubscribe: () => void }> {
    await this.getOrLoadSession(code);

    const deferred = createDeferred<unknown>();
    const sourcePreview = buildInspectorSourcePreview(input);
    const taskId = crypto.randomUUID();
    const task: VmExecutionTaskInternal = {
      taskId,
      sessionCode: code,
      input,
      language,
      cellId: options.cellId ?? null,
      previousCellId: options.previousCellId ?? null,
      status: "queued",
      queuedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      sourcePreview: sourcePreview.preview,
      sourceLineCount: sourcePreview.lineCount,
      cancelRequested: false,
      logs: [],
      logLineCount: 0,
      pendingStdoutChunk: "",
      pendingStderrChunk: "",
      result: undefined,
      serializedResult: null,
      errorMessage: null,
      completion: deferred.promise,
      resolve: deferred.resolve,
      reject: deferred.reject,
    };

    void task.completion.catch(() => undefined);

    this.executionTasks.set(taskId, task);
    const unsubscribe = listener ? this.subscribeToExecutionTask(taskId, listener) : () => {};
    this.queuedExecutionTaskIds.push(taskId);
    this.emitExecutionEvent(taskId, {
      type: "queued",
      task: this.createExecutionTaskSnapshot(task),
    });
    this.emitQueueStateUpdates();
    this.scheduleExecutionQueuePump();

    return {
      taskId,
      completion: task.completion,
      unsubscribe,
    };
  }

  cancelExecutionTask(taskId: string): VmExecutionStreamCancelAckEvent {
    const task = this.executionTasks.get(taskId);
    if (!task) {
      return {
        type: "cancel-ack",
        taskId,
        accepted: false,
        status: "unknown",
        message: "Unknown execution task.",
      };
    }

    if (task.status === "queued") {
      task.cancelRequested = true;
      task.status = "cancelled";
      task.completedAt = Date.now();
      task.errorMessage = "Execution cancelled before start.";
      this.appendExecutionTaskLogLines(task, [task.errorMessage]);
      this.removeQueuedExecutionTask(task.taskId);
      task.reject(new VmExecutionCancelledError(task.taskId, task.errorMessage));
      const ack: VmExecutionStreamCancelAckEvent = {
        type: "cancel-ack",
        taskId,
        accepted: true,
        status: "cancelled",
        message: task.errorMessage,
      };
      this.emitExecutionEvent(taskId, ack);
      this.emitExecutionEvent(taskId, {
        type: "cancelled",
        task: this.createExecutionTaskSnapshot(task),
        reason: task.errorMessage,
      });
      this.emitExecutionEvent(taskId, {
        type: "complete",
        task: this.createExecutionTaskSnapshot(task),
      });
      this.rememberCompletedExecutionTask(task.taskId);
      this.emitQueueStateUpdates();
      this.scheduleExecutionQueuePump();
      return ack;
    }

    if (task.status === "running") {
      task.cancelRequested = true;
      this.appendExecutionTaskLogLines(task, ["Cancellation requested. The VM will stop at the next safe boundary."]);
      const ack: VmExecutionStreamCancelAckEvent = {
        type: "cancel-ack",
        taskId,
        accepted: true,
        status: "running",
        message: "Cancellation requested. The VM will stop at the next safe boundary.",
      };
      this.emitExecutionEvent(taskId, ack);
      return ack;
    }

    return {
      type: "cancel-ack",
      taskId,
      accepted: false,
      status: task.status,
      message: `Execution task is already ${task.status}.`,
    };
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

  async inspectSession(code: string) {
    const session = await this.getOrLoadSession(code);
    const vmState = session.vm.inspectState();
    return this.createInspectorSnapshot(session, vmState);
  }

  async listInspectorRootGroups(code: string) {
    const session = await this.getOrLoadSession(code);
    return session.vm.listInspectorRootGroups();
  }

  async readInspectorStreamState(code: string) {
    const session = await this.getOrLoadSession(code);
    const vmState = session.vm.inspectState();
    return {
      snapshot: this.createInspectorSnapshot(session, vmState),
      rootGroups: session.vm.listInspectorRootGroups(),
    };
  }

  async inspectSessionNode(code: string, handle: string) {
    const session = await this.getOrLoadSession(code);

    try {
      return session.vm.inspectNode(handle);
    } catch (error) {
      throw new VmServerHttpError(400, buildErrorMessage(error), error);
    }
  }

  private throwIfExecutionCancelled(execution: { taskId?: string; shouldCancel?: () => boolean }): void {
    if (execution.shouldCancel?.()) {
      throw new VmExecutionCancelledError(execution.taskId ?? "unknown");
    }
  }

  private createExecutionTaskSnapshot(task: VmExecutionTaskInternal): VmExecutionTaskSnapshot {
    const queueIndex = this.queuedExecutionTaskIds.indexOf(task.taskId);
    const queueLength = this.queuedExecutionTaskIds.length + (this.activeExecutionTaskId ? 1 : 0);
    return {
      taskId: task.taskId,
      code: task.sessionCode,
      language: task.language,
      cellId: task.cellId,
      previousCellId: task.previousCellId,
      status: task.status,
      queuedAt: new Date(task.queuedAt).toISOString(),
      startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
      completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
      sourcePreview: task.sourcePreview,
      sourceLineCount: task.sourceLineCount,
      cancelRequested: task.cancelRequested,
      queuePosition: queueIndex >= 0 ? queueIndex + 1 + (this.activeExecutionTaskId ? 1 : 0) : task.status === "running" ? 1 : null,
      queueLength,
      logs: [...task.logs],
      logLineCount: task.logLineCount,
    };
  }

  private appendExecutionTaskLogLines(task: VmExecutionTaskInternal, lines: readonly string[], prefix?: string): void {
    for (const line of lines) {
      const normalizedLine = truncateInspectorText(
        line.replace(/\u001B\[[0-9;]*m/g, "").trimEnd(),
        EXECUTION_TASK_LOG_LINE_MAX_LENGTH,
      );
      if (normalizedLine.trim().length === 0) {
        continue;
      }

      task.logs.push(prefix ? `${prefix}${normalizedLine}` : normalizedLine);
      task.logLineCount += 1;
      if (task.logs.length > MAX_RETAINED_EXECUTION_TASK_LOG_LINES) {
        task.logs.splice(0, task.logs.length - MAX_RETAINED_EXECUTION_TASK_LOG_LINES);
      }
    }
  }

  private appendExecutionTaskLogChunk(task: VmExecutionTaskInternal, stream: Extract<ExecutionLogStream, "stdout" | "stderr">, chunk: string): void {
    const normalizedChunk = chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const bufferKey = stream === "stdout" ? "pendingStdoutChunk" : "pendingStderrChunk";
    const combined = `${task[bufferKey]}${normalizedChunk}`;
    const segments = combined.split("\n");
    task[bufferKey] = segments.pop() ?? "";
    this.appendExecutionTaskLogLines(task, segments, `${stream} | `);
  }

  private flushExecutionTaskLogBuffers(task: VmExecutionTaskInternal): void {
    if (task.pendingStdoutChunk.length > 0) {
      this.appendExecutionTaskLogLines(task, [task.pendingStdoutChunk], "stdout | ");
      task.pendingStdoutChunk = "";
    }

    if (task.pendingStderrChunk.length > 0) {
      this.appendExecutionTaskLogLines(task, [task.pendingStderrChunk], "stderr | ");
      task.pendingStderrChunk = "";
    }
  }

  private appendExecutionTaskOutput(task: VmExecutionTaskInternal, items: readonly OutputEntity[]): void {
    const renderedLines = renderOutputEntities(items, EXECUTION_TASK_OUTPUT_RENDER_WIDTH)
      .map((entry) => entry.text);
    this.appendExecutionTaskLogLines(task, renderedLines);
  }

  private listExecutionTaskSnapshots(code: string): VmExecutionTaskSnapshot[] {
    return [...this.executionTasks.values()]
      .filter((task) => task.sessionCode === code)
      .sort((left, right) => {
        const leftTimestamp = left.startedAt ?? left.queuedAt;
        const rightTimestamp = right.startedAt ?? right.queuedAt;
        return rightTimestamp - leftTimestamp;
      })
      .map((task) => this.createExecutionTaskSnapshot(task));
  }

  private subscribeToExecutionTask(taskId: string, listener: VmExecutionTaskListener): () => void {
    const listeners = this.executionTaskListeners.get(taskId) ?? new Set<VmExecutionTaskListener>();
    listeners.add(listener);
    this.executionTaskListeners.set(taskId, listeners);

    return () => {
      const currentListeners = this.executionTaskListeners.get(taskId);
      if (!currentListeners) {
        return;
      }

      currentListeners.delete(listener);
      if (currentListeners.size === 0) {
        this.executionTaskListeners.delete(taskId);
      }
    };
  }

  private emitExecutionEvent(taskId: string, event: VmExecutionStreamServerMessage): void {
    const listeners = this.executionTaskListeners.get(taskId);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error({ error, taskId }, "Execution task listener failed");
      }
    }
  }

  private emitQueueStateUpdates(): void {
    for (const taskId of this.queuedExecutionTaskIds) {
      const task = this.executionTasks.get(taskId);
      if (!task) {
        continue;
      }

      this.emitExecutionEvent(taskId, {
        type: "queue",
        task: this.createExecutionTaskSnapshot(task),
      });
    }
  }

  private scheduleExecutionQueuePump(): void {
    void this.processExecutionQueue().catch((error) => {
      logger.error({ error }, "Execution queue pump failed");
    });
  }

  private async processExecutionQueue(): Promise<void> {
    if (this.isProcessingExecutionQueue) {
      return;
    }

    this.isProcessingExecutionQueue = true;

    try {
      while (!this.activeExecutionTaskId && this.queuedExecutionTaskIds.length > 0) {
        const nextTaskId = this.queuedExecutionTaskIds.shift();
        if (!nextTaskId) {
          break;
        }

        const task = this.executionTasks.get(nextTaskId);
        this.emitQueueStateUpdates();
        if (!task || task.status !== "queued") {
          continue;
        }

        if (task.cancelRequested) {
          continue;
        }

        this.activeExecutionTaskId = nextTaskId;
        this.emitQueueStateUpdates();
        await this.runExecutionTask(task);
        this.activeExecutionTaskId = null;
        this.emitQueueStateUpdates();
      }
    } finally {
      this.isProcessingExecutionQueue = false;
      if (!this.activeExecutionTaskId && this.queuedExecutionTaskIds.length > 0) {
        queueMicrotask(() => {
          this.scheduleExecutionQueuePump();
        });
      }
    }
  }

  private async runExecutionTask(task: VmExecutionTaskInternal): Promise<void> {
    const session = await this.getOrLoadSession(task.sessionCode);
    let previousOutputCount = session.vm.getOutputItems().length;
    const unsubscribeOutput = session.vm.subscribeOutput((items) => {
      const nextItems = items.length >= previousOutputCount
        ? items.slice(previousOutputCount)
        : items;
      previousOutputCount = items.length;
      if (nextItems.length === 0) {
        return;
      }

      this.appendExecutionTaskOutput(task, nextItems);
    });

    task.status = "running";
    task.startedAt = Date.now();
    this.emitExecutionEvent(task.taskId, {
      type: "started",
      task: this.createExecutionTaskSnapshot(task),
    });

    try {
      const result = await runWithExecutionLogSink(
        (entry) => {
          if (entry.stream === "log") {
            this.appendExecutionTaskLogLines(task, [entry.chunk]);
            return;
          }

          this.appendExecutionTaskLogChunk(task, entry.stream, entry.chunk);
        },
        () => runWithLoggerOutputSink(
          (line) => {
            this.appendExecutionTaskLogLines(task, [line]);
          },
          () => this.evaluateWithLanguage(
            task.sessionCode,
            task.input,
            task.language,
            {
              cellId: task.cellId ?? undefined,
              previousCellId: task.previousCellId ?? undefined,
            },
            {
              taskId: task.taskId,
              shouldCancel: () => task.cancelRequested,
            },
          ),
        ),
      );
      task.result = result;
      task.serializedResult = serializeVmResult(result);
      task.status = "completed";
      task.completedAt = Date.now();
      task.resolve(result);
      this.emitExecutionEvent(task.taskId, {
        type: "result",
        taskId: task.taskId,
        result: task.serializedResult,
      });
      this.emitExecutionEvent(task.taskId, {
        type: "complete",
        task: this.createExecutionTaskSnapshot(task),
      });
    } catch (error) {
      task.errorMessage = buildErrorMessage(error);
      task.completedAt = Date.now();

      if (error instanceof VmExecutionCancelledError || task.cancelRequested) {
        task.status = "cancelled";
        const cancelError = error instanceof VmExecutionCancelledError
          ? error
          : new VmExecutionCancelledError(task.taskId);
        task.reject(cancelError);
        this.emitExecutionEvent(task.taskId, {
          type: "cancelled",
          task: this.createExecutionTaskSnapshot(task),
          reason: task.errorMessage || cancelError.message,
        });
      } else {
        task.status = "failed";
        task.reject(error);
        this.emitExecutionEvent(task.taskId, {
          type: "error",
          taskId: task.taskId,
          error: task.errorMessage,
        });
      }

      this.emitExecutionEvent(task.taskId, {
        type: "complete",
        task: this.createExecutionTaskSnapshot(task),
      });
    } finally {
      unsubscribeOutput();
      this.flushExecutionTaskLogBuffers(task);
      this.rememberCompletedExecutionTask(task.taskId);
    }
  }

  private removeQueuedExecutionTask(taskId: string): void {
    const queueIndex = this.queuedExecutionTaskIds.indexOf(taskId);
    if (queueIndex >= 0) {
      this.queuedExecutionTaskIds.splice(queueIndex, 1);
    }
  }

  private rememberCompletedExecutionTask(taskId: string): void {
    this.completedExecutionTaskIds.push(taskId);
    while (this.completedExecutionTaskIds.length > MAX_RETAINED_EXECUTION_TASKS) {
      const oldestTaskId = this.completedExecutionTaskIds.shift();
      if (!oldestTaskId || oldestTaskId === this.activeExecutionTaskId || this.queuedExecutionTaskIds.includes(oldestTaskId)) {
        continue;
      }

      this.executionTasks.delete(oldestTaskId);
      this.executionTaskListeners.delete(oldestTaskId);
    }
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
      activeEvaluation: null,
      notebookCellResults: new Map(),
      lastNotebookCellId: null,
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
      activeEvaluation: null,
      notebookCellResults: new Map(),
      lastNotebookCellId: null,
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
    session.activeEvaluation = null;
    session.notebookCellResults = new Map();
    session.lastNotebookCellId = null;
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
