export type BackgroundWorkerStatus = "starting" | "running" | "stopping" | "stopped" | "error";

export type BackgroundLifecycleEnvironment = {
	apiVersion: 1;
	workspaceRoot: string;
	scriptsDir: string;
	bootedAt: string;
};

export type BackgroundWorkerDescriptor = {
	id: string;
	name: string;
	scriptPath: string;
	relativeScriptPath: string;
	smol: boolean;
};

export type BackgroundWorkerRuntimeData = {
	descriptor: BackgroundWorkerDescriptor;
	metricsIntervalMs: number;
};

export type BackgroundWorkerLogLevel = "debug" | "info" | "warn" | "error";

export type BackgroundWorkerResourceLimits = {
	maxYoungGenerationSizeMb?: number;
	maxOldGenerationSizeMb?: number;
	codeRangeSizeMb?: number;
	stackSizeMb?: number;
};

export type BackgroundWorkerMemoryUsage = {
	rssMb: number;
	heapTotalMb: number;
	heapUsedMb: number;
	externalMb: number;
	arrayBuffersMb: number;
};

export type BackgroundWorkerMetrics = {
	resourceLimits?: BackgroundWorkerResourceLimits;
	memoryUsage?: BackgroundWorkerMemoryUsage;
	uptimeSeconds?: number;
};

export type BackgroundWorkerLogEntry = {
	kind: "state" | "log" | "event" | "metrics";
	at: string;
	message: string;
	level?: BackgroundWorkerLogLevel;
	payload?: string;
};

export type BackgroundWorkerMessage =
	| {
			type: "state";
			status: BackgroundWorkerStatus;
			at: string;
			detail?: string;
		}
	| {
			type: "log";
			level: BackgroundWorkerLogLevel;
			message: string;
			at: string;
			data?: unknown;
		}
	| {
			type: "event";
			event: string;
			at: string;
			payload?: unknown;
		}
	| {
			type: "metrics";
			at: string;
			metrics: BackgroundWorkerMetrics;
		};

export type BackgroundWorkerSnapshot = BackgroundWorkerDescriptor & {
	status: BackgroundWorkerStatus;
	startedAt: string;
	updatedAt: string;
	lastEvent?: string;
	lastPayload?: string;
	lastMessageAt?: string;
	lastError?: string;
	lastErrorAt?: string;
	lastLog?: string;
	lastLogLevel?: BackgroundWorkerLogLevel;
	resourceLimits?: BackgroundWorkerResourceLimits;
	lastMetrics?: BackgroundWorkerMetrics;
	logs: BackgroundWorkerLogEntry[];
	stopReason?: string;
	pid: number;
};