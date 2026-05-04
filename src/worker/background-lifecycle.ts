import { readdir } from "fs/promises";
import path from "path";
import { setEnvironmentData } from "worker_threads";

import { $storageKit } from "../kits/storage-kit";
import { logger as defaultLogger } from "../logger";

import { BACKGROUND_ENVIRONMENT_DATA_KEY } from "./api";
import type {
  BackgroundLifecycleEnvironment,
  BackgroundWorkerDescriptor,
  BackgroundWorkerLogEntry,
  BackgroundWorkerMessage,
  BackgroundWorkerMetrics,
  BackgroundWorkerResourceLimits,
  BackgroundWorkerSnapshot,
} from "./types";

const WORKER_LOG_HISTORY_LIMIT = 80;

const SUPPORTED_SCRIPT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".cts",
]);

const EXCLUDED_BACKGROUND_SCRIPT_NAMES = new Set([
  "build-bundle.ts",
  "boot.ts",
]);

export type BackgroundLifecycleOptions = {
  workspaceRoot?: string;
  scriptsDir?: string;
  smol?: boolean;
  metricsIntervalMs?: number;
  watchRefreshMs?: number;
  resourceLimits?: BackgroundWorkerResourceLimits;
  logger?: typeof defaultLogger;
};

type WorkerHandle = {
  worker: Worker;
  snapshot: BackgroundWorkerSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatBackgroundError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}

function cloneSnapshot(
  snapshot: BackgroundWorkerSnapshot,
): BackgroundWorkerSnapshot {
  return {
    ...snapshot,
    resourceLimits: snapshot.resourceLimits
      ? { ...snapshot.resourceLimits }
      : undefined,
    lastMetrics: snapshot.lastMetrics
      ? {
        ...snapshot.lastMetrics,
        resourceLimits: snapshot.lastMetrics.resourceLimits
          ? { ...snapshot.lastMetrics.resourceLimits }
          : undefined,
        memoryUsage: snapshot.lastMetrics.memoryUsage
          ? { ...snapshot.lastMetrics.memoryUsage }
          : undefined,
      }
      : undefined,
    logs: snapshot.logs.map((entry) => ({ ...entry })),
  };
}

function summarizePayload(payload: unknown): string | undefined {
  if (payload === undefined) {
    return undefined;
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (
    typeof payload === "number" ||
    typeof payload === "boolean" ||
    payload === null
  ) {
    return String(payload);
  }

  try {
    const json = JSON.stringify(payload);
    if (!json) {
      return undefined;
    }

    return json.length > 120 ? `${json.slice(0, 117)}...` : json;
  } catch {
    return String(payload);
  }
}

function isBackgroundWorkerMessage(
  value: unknown,
): value is BackgroundWorkerMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "state") {
    return typeof value.status === "string" && typeof value.at === "string";
  }

  if (value.type === "log") {
    return (
      typeof value.level === "string" &&
      typeof value.message === "string" &&
      typeof value.at === "string"
    );
  }

  if (value.type === "event") {
    return typeof value.event === "string" && typeof value.at === "string";
  }

  if (value.type === "metrics") {
    return isRecord(value.metrics) && typeof value.at === "string";
  }

  return false;
}

function formatResourceLimits(resourceLimits: BackgroundWorkerMetrics["resourceLimits"]): string | undefined {
  if (!resourceLimits) {
    return undefined;
  }

  const items = [
    resourceLimits.maxYoungGenerationSizeMb !== undefined ? `young=${resourceLimits.maxYoungGenerationSizeMb}MB` : undefined,
    resourceLimits.maxOldGenerationSizeMb !== undefined ? `old=${resourceLimits.maxOldGenerationSizeMb}MB` : undefined,
    resourceLimits.codeRangeSizeMb !== undefined ? `code=${resourceLimits.codeRangeSizeMb}MB` : undefined,
    resourceLimits.stackSizeMb !== undefined ? `stack=${resourceLimits.stackSizeMb}MB` : undefined,
  ].filter(Boolean);

  return items.length > 0 ? items.join(", ") : undefined;
}

function formatMemoryUsage(memoryUsage: BackgroundWorkerMetrics["memoryUsage"]): string | undefined {
  if (!memoryUsage) {
    return undefined;
  }

  return `rss=${memoryUsage.rssMb}MB heap=${memoryUsage.heapUsedMb}/${memoryUsage.heapTotalMb}MB ext=${memoryUsage.externalMb}MB`;
}

function hasResourceLimits(resourceLimits: BackgroundWorkerMetrics["resourceLimits"]): boolean {
  if (!resourceLimits) {
    return false;
  }

  return Object.values(resourceLimits).some((value) => value !== undefined);
}

function appendLogEntry(snapshot: BackgroundWorkerSnapshot, entry: BackgroundWorkerLogEntry): void {
  snapshot.logs.push(entry);
  if (snapshot.logs.length > WORKER_LOG_HISTORY_LIMIT) {
    snapshot.logs.splice(0, snapshot.logs.length - WORKER_LOG_HISTORY_LIMIT);
  }
}

export class BackgroundLifecycle {
  private readonly workspaceRoot: string;
  private readonly scriptsDir: string;
  private readonly smol: boolean;
  private readonly metricsIntervalMs: number;
  private readonly watchRefreshMs: number;
  private readonly resourceLimits: BackgroundWorkerResourceLimits;
  private readonly logger: typeof defaultLogger;
  private readonly workerEntrypoint: string;
  private readonly workers = new Map<string, WorkerHandle>();
  private environment: BackgroundLifecycleEnvironment | null = null;
  private started = false;
  private workerLogPersistenceAvailable = true;
  private workerLogPersistenceFailureReported = false;

  constructor(options: BackgroundLifecycleOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.scriptsDir =
      options.scriptsDir ?? path.join(this.workspaceRoot, "scripts");
    this.smol = options.smol ?? true;
    this.metricsIntervalMs = options.metricsIntervalMs ?? 1000;
    this.watchRefreshMs = options.watchRefreshMs ?? 1000;
    this.resourceLimits = { ...(options.resourceLimits ?? {}) };
    this.logger = options.logger ?? defaultLogger;
    this.workerEntrypoint = new URL(
      "./worker-runtime.ts",
      import.meta.url,
    ).href;
  }

  async start(): Promise<BackgroundWorkerSnapshot[]> {
    if (this.started) {
      return this.getWorkerSnapshots();
    }

    this.started = true;
    this.environment = {
      apiVersion: 1,
      workspaceRoot: this.workspaceRoot,
      scriptsDir: this.scriptsDir,
      bootedAt: new Date().toISOString(),
    };
    setEnvironmentData(BACKGROUND_ENVIRONMENT_DATA_KEY, this.environment);

    const scriptPaths = await this.discoverScriptPaths();
    for (const scriptPath of scriptPaths) {
      this.spawnWorker(scriptPath);
    }

    return this.getWorkerSnapshots();
  }

  async stop(): Promise<void> {
    const workerHandles = [...this.workers.values()];
    await Promise.allSettled(
      workerHandles.map(async (handle) => {
        await this.stopWorkerHandle(handle, "lifecycle.stop()");
      }),
    );
    this.started = false;
  }

  async stopWorker(target: string): Promise<BackgroundWorkerSnapshot> {
    const handle = this.resolveWorkerHandle(target);
    await this.stopWorkerHandle(handle, `manual stop: ${target}`);
    return cloneSnapshot(handle.snapshot);
  }

  async restartWorker(target: string): Promise<BackgroundWorkerSnapshot> {
    const handle = this.resolveWorkerHandle(target);
    const scriptPath = handle.snapshot.scriptPath;
    await this.stopWorkerHandle(handle, `manual restart: ${target}`);
    this.workers.delete(handle.snapshot.id);
    const nextHandle = this.spawnWorker(scriptPath);
    return cloneSnapshot(nextHandle.snapshot);
  }

  getWorkerLogs(target: string): BackgroundWorkerLogEntry[] {
    const handle = this.resolveWorkerHandle(target);
    if (this.workerLogPersistenceAvailable) {
      try {
        const persistedLogs = $storageKit.readBackgroundWorkerLogs(
          handle.snapshot.relativeScriptPath,
        );

        if (persistedLogs.length > 0) {
          return persistedLogs;
        }
      } catch (error) {
        this.disableWorkerLogPersistence(error);
      }
    }

    return handle.snapshot.logs.map((entry) => ({ ...entry }));
  }

  getWorkerSnapshots(): BackgroundWorkerSnapshot[] {
    return [...this.workers.values()]
      .map(({ snapshot }) => cloneSnapshot(snapshot))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  isStarted(): boolean {
    return this.started;
  }

	getWatchRefreshMs(): number {
		return this.watchRefreshMs;
	}

  private async discoverScriptPaths(): Promise<string[]> {
    try {
      const entries = await readdir(this.scriptsDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .filter((entry) =>
          SUPPORTED_SCRIPT_EXTENSIONS.has(
            path.extname(entry.name).toLowerCase(),
          ),
        )
        .filter((entry) => !EXCLUDED_BACKGROUND_SCRIPT_NAMES.has(entry.name))
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => path.join(this.scriptsDir, entry.name))
        .sort((left, right) => left.localeCompare(right));
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  private spawnWorker(scriptPath: string): WorkerHandle {
    const startedAt = new Date().toISOString();
    const relativeScriptPath =
      path.relative(this.workspaceRoot, scriptPath) ||
      path.basename(scriptPath);
    const descriptor: BackgroundWorkerDescriptor = {
      id: `worker:${Date.now()}:${crypto.randomUUID()}`,
      name: path.basename(scriptPath, path.extname(scriptPath)),
      scriptPath,
      relativeScriptPath,
      smol: this.smol,
    };
    const snapshot: BackgroundWorkerSnapshot = {
      ...descriptor,
      status: "starting",
      startedAt,
      updatedAt: startedAt,
      resourceLimits: { ...this.resourceLimits },
      logs: [],
      pid: process.pid,
    };

    const worker = new Worker(this.workerEntrypoint, {
      smol: this.smol,
      resourceLimits: this.resourceLimits,
      workerData: {
        descriptor,
        metricsIntervalMs: this.metricsIntervalMs,
      },
    } as WorkerOptions & {
      resourceLimits: BackgroundWorkerResourceLimits;
      workerData: {
        descriptor: BackgroundWorkerDescriptor;
        metricsIntervalMs: number;
      };
    });
    worker.onmessage = (event) => {
      this.handleWorkerMessage(snapshot, event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.failSnapshot(snapshot, event.message || "Worker crashed.");
    };
    worker.onmessageerror = () => {
      this.failSnapshot(snapshot, "Worker emitted an unreadable message.");
    };

    const handle = { worker, snapshot };
    this.workers.set(descriptor.id, handle);
    return handle;
  }

  private resolveWorkerHandle(target: string): WorkerHandle {
    const normalizedTarget = target.trim();
    if (normalizedTarget.length === 0) {
      throw new Error("Worker target is required.");
    }

    const matches = [...this.workers.values()].filter(
      ({ snapshot }) =>
        snapshot.id === normalizedTarget ||
        snapshot.name === normalizedTarget ||
        snapshot.relativeScriptPath === normalizedTarget ||
        snapshot.scriptPath === normalizedTarget,
    );

    if (matches.length === 0) {
      throw new Error(`Worker not found: ${normalizedTarget}`);
    }

    if (matches.length > 1) {
      throw new Error(`Worker target is ambiguous: ${normalizedTarget}`);
    }

    return matches[0] as WorkerHandle;
  }

  private async stopWorkerHandle(
    handle: WorkerHandle,
    reason: string,
  ): Promise<void> {
    const { worker, snapshot } = handle;
    if (snapshot.status === "stopped" || snapshot.status === "error") {
      this.updateSnapshot(snapshot, {
        stopReason: snapshot.stopReason ?? reason,
      });
      return;
    }

    this.updateSnapshot(snapshot, { status: "stopping", stopReason: reason });
    try {
      await worker.terminate();
      this.updateSnapshot(snapshot, { status: "stopped", stopReason: reason });
    } catch (error) {
      this.failSnapshot(snapshot, formatBackgroundError(error));
    }
  }

  private handleWorkerMessage(
    snapshot: BackgroundWorkerSnapshot,
    data: unknown,
  ): void {
    if (!isBackgroundWorkerMessage(data)) {
      this.updateSnapshot(snapshot, {
        lastEvent: "message",
        lastPayload: summarizePayload(data),
        lastMessageAt: new Date().toISOString(),
      });
    this.recordLogEntry(snapshot, {
			kind: "event",
			at: new Date().toISOString(),
			message: "message",
			payload: summarizePayload(data),
		});
      return;
    }

    if (data.type === "state") {
      this.updateSnapshot(snapshot, {
        status: data.status,
        lastEvent: data.detail ?? data.status,
        lastMessageAt: data.at,
        stopReason:
          data.status === "stopped" ? data.detail : snapshot.stopReason,
        lastError:
          data.status === "error"
            ? (data.detail ?? snapshot.lastError)
            : snapshot.lastError,
        lastErrorAt: data.status === "error" ? data.at : snapshot.lastErrorAt,
      });
		this.recordLogEntry(snapshot, {
			kind: "state",
			at: data.at,
			message: data.detail ?? data.status,
		});
      return;
    }

    if (data.type === "log") {
      this.updateSnapshot(snapshot, {
        lastLog: data.message,
        lastLogLevel: data.level,
        lastMessageAt: data.at,
        lastEvent: `log:${data.level}`,
        lastPayload: summarizePayload(data.data),
      });
		this.recordLogEntry(snapshot, {
			kind: "log",
			at: data.at,
			message: data.message,
			level: data.level,
			payload: summarizePayload(data.data),
		});
      const meta = {
        workerId: snapshot.id,
        script: snapshot.relativeScriptPath,
        data: data.data,
      };
      switch (data.level) {
        case "debug":
          this.logger.debug(meta, data.message);
          break;
        case "info":
          this.logger.info(meta, data.message);
          break;
        case "warn":
          this.logger.warn(meta, data.message);
          break;
        case "error":
          this.logger.error(meta, data.message);
          break;
      }
      return;
    }

    if (data.type === "metrics") {
      this.updateSnapshot(snapshot, {
        lastEvent: "metrics",
        lastPayload: formatMemoryUsage(data.metrics.memoryUsage) ?? formatResourceLimits(data.metrics.resourceLimits),
        lastMessageAt: data.at,
        resourceLimits: hasResourceLimits(data.metrics.resourceLimits)
          ? data.metrics.resourceLimits
          : snapshot.resourceLimits,
        lastMetrics: data.metrics,
      });
      this.recordLogEntry(snapshot, {
        kind: "metrics",
        at: data.at,
        message: `metrics uptime=${data.metrics.uptimeSeconds ?? 0}s`,
        payload: [
          formatMemoryUsage(data.metrics.memoryUsage),
          formatResourceLimits(data.metrics.resourceLimits),
        ].filter(Boolean).join(" | "),
      });
      return;
    }

    this.updateSnapshot(snapshot, {
      lastEvent: data.event,
      lastPayload: summarizePayload(data.payload),
      lastMessageAt: data.at,
    });
    this.recordLogEntry(snapshot, {
      kind: "event",
      at: data.at,
      message: data.event,
      payload: summarizePayload(data.payload),
    });
  }

  private updateSnapshot(
    snapshot: BackgroundWorkerSnapshot,
    patch: Partial<
      Pick<
        BackgroundWorkerSnapshot,
        | "status"
        | "lastEvent"
        | "lastPayload"
        | "lastMessageAt"
        | "lastError"
        | "lastErrorAt"
        | "lastLog"
        | "lastLogLevel"
      | "resourceLimits"
      | "lastMetrics"
        | "stopReason"
      >
    >,
  ): void {
    snapshot.status = patch.status ?? snapshot.status;
    snapshot.lastEvent = patch.lastEvent ?? snapshot.lastEvent;
    snapshot.lastPayload = patch.lastPayload ?? snapshot.lastPayload;
    snapshot.lastMessageAt = patch.lastMessageAt ?? snapshot.lastMessageAt;
    snapshot.lastError = patch.lastError ?? snapshot.lastError;
    snapshot.lastErrorAt = patch.lastErrorAt ?? snapshot.lastErrorAt;
    snapshot.lastLog = patch.lastLog ?? snapshot.lastLog;
    snapshot.lastLogLevel = patch.lastLogLevel ?? snapshot.lastLogLevel;
    snapshot.resourceLimits = patch.resourceLimits ?? snapshot.resourceLimits;
    snapshot.lastMetrics = patch.lastMetrics ?? snapshot.lastMetrics;
    snapshot.stopReason = patch.stopReason ?? snapshot.stopReason;
    snapshot.updatedAt = new Date().toISOString();
  }

  private failSnapshot(
    snapshot: BackgroundWorkerSnapshot,
    error: string,
  ): void {
    const failedAt = new Date().toISOString();
    this.updateSnapshot(snapshot, {
      status: "error",
      lastError: error,
      lastErrorAt: failedAt,
      lastEvent: "error",
    });
    this.recordLogEntry(snapshot, {
      kind: "state",
      at: failedAt,
      message: error,
    });
  }

  private recordLogEntry(
    snapshot: BackgroundWorkerSnapshot,
    entry: BackgroundWorkerLogEntry,
  ): void {
    appendLogEntry(snapshot, entry);

    if (!this.workerLogPersistenceAvailable) {
      return;
    }

    try {
      $storageKit.appendBackgroundWorkerLog({
        workerId: snapshot.id,
        workerName: snapshot.name,
        relativeScriptPath: snapshot.relativeScriptPath,
        scriptPath: snapshot.scriptPath,
        workerStartedAt: snapshot.startedAt,
        entry,
      });
    } catch (error) {
      this.disableWorkerLogPersistence(error);
    }
  }

  private disableWorkerLogPersistence(error: unknown): void {
    this.workerLogPersistenceAvailable = false;
    if (this.workerLogPersistenceFailureReported) {
      return;
    }

    this.workerLogPersistenceFailureReported = true;
    this.logger.error(
      { error: formatBackgroundError(error) },
      "Failed to persist background worker logs.",
    );
  }
}
