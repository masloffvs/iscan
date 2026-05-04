export { BackgroundLifecycle } from "./background-lifecycle";
export type { BackgroundLifecycleOptions } from "./background-lifecycle";
export {
	BACKGROUND_ENVIRONMENT_DATA_KEY,
	createBackgroundScriptContext,
	defineBackgroundScript,
	getBackgroundDescriptor,
	getBackgroundEnvironment,
	postWorkerState,
	sleep,
} from "./api";
export type { BackgroundScriptContext, BackgroundScriptHandler, BackgroundWorkerLogger } from "./api";
export type {
	BackgroundLifecycleEnvironment,
	BackgroundWorkerLogEntry,
	BackgroundWorkerDescriptor,
	BackgroundWorkerLogLevel,
	BackgroundWorkerMemoryUsage,
	BackgroundWorkerMessage,
	BackgroundWorkerMetrics,
	BackgroundWorkerResourceLimits,
	BackgroundWorkerRuntimeData,
	BackgroundWorkerSnapshot,
	BackgroundWorkerStatus,
} from "./types";