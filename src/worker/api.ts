import { getEnvironmentData, parentPort, workerData } from "node:worker_threads";

import type {
	BackgroundLifecycleEnvironment,
	BackgroundWorkerDescriptor,
	BackgroundWorkerLogLevel,
	BackgroundWorkerMessage,
	BackgroundWorkerRuntimeData,
	BackgroundWorkerStatus,
} from "./types";
import { $storageKit, type StorageKit } from "../kits/storage-kit";

export const BACKGROUND_ENVIRONMENT_DATA_KEY = "iscan.background.environment";

export type BackgroundWorkerLogger = {
	debug(message: string, data?: unknown): void;
	info(message: string, data?: unknown): void;
	warn(message: string, data?: unknown): void;
	error(message: string, data?: unknown): void;
};

export type BackgroundScriptContext = {
	descriptor: BackgroundWorkerDescriptor;
	environment: BackgroundLifecycleEnvironment;
	logger: BackgroundWorkerLogger;
	storage: StorageKit;
	emit(event: string, payload?: unknown): void;
	postMessage(payload: unknown): void;
	onMessage(listener: (payload: unknown) => void): () => void;
	sleep(ms: number): Promise<void>;
};

export type BackgroundScriptHandler = (context: BackgroundScriptContext) => unknown | Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function postBackgroundMessage(message: BackgroundWorkerMessage): void {
	parentPort?.postMessage(message);
}

function readRuntimeData(): BackgroundWorkerRuntimeData {
	if (!isRecord(workerData) || !isRecord(workerData.descriptor)) {
		throw new Error("Background worker data is missing.");
	}

	const descriptor = workerData.descriptor;
	if (
		typeof descriptor.id !== "string"
		|| typeof descriptor.name !== "string"
		|| typeof descriptor.scriptPath !== "string"
		|| typeof descriptor.relativeScriptPath !== "string"
		|| typeof descriptor.smol !== "boolean"
		|| typeof workerData.metricsIntervalMs !== "number"
	) {
		throw new Error("Background worker descriptor is invalid.");
	}

	return {
		descriptor: {
			id: descriptor.id,
			name: descriptor.name,
			scriptPath: descriptor.scriptPath,
			relativeScriptPath: descriptor.relativeScriptPath,
			smol: descriptor.smol,
		},
		metricsIntervalMs: workerData.metricsIntervalMs,
	};
}

export function getBackgroundEnvironment(): BackgroundLifecycleEnvironment {
	const environment = getEnvironmentData(BACKGROUND_ENVIRONMENT_DATA_KEY);
	if (!isRecord(environment)) {
		throw new Error("Background lifecycle environment data is not available.");
	}

	if (
		environment.apiVersion !== 1
		|| typeof environment.workspaceRoot !== "string"
		|| typeof environment.scriptsDir !== "string"
		|| typeof environment.bootedAt !== "string"
	) {
		throw new Error("Background lifecycle environment data is invalid.");
	}

	return {
		apiVersion: 1,
		workspaceRoot: environment.workspaceRoot,
		scriptsDir: environment.scriptsDir,
		bootedAt: environment.bootedAt,
	};
}

export function getBackgroundDescriptor(): BackgroundWorkerDescriptor {
	return readRuntimeData().descriptor;
}

export function getBackgroundMetricsIntervalMs(): number {
	return readRuntimeData().metricsIntervalMs;
}

function createBackgroundLogger(): BackgroundWorkerLogger {
	const log = (level: BackgroundWorkerLogLevel, message: string, data?: unknown) => {
		postBackgroundMessage({
			type: "log",
			level,
			message,
			data,
			at: new Date().toISOString(),
		});
	};

	return {
		debug: (message, data) => log("debug", message, data),
		info: (message, data) => log("info", message, data),
		warn: (message, data) => log("warn", message, data),
		error: (message, data) => log("error", message, data),
	};
}

export function createBackgroundScriptContext(): BackgroundScriptContext {
	const descriptor = getBackgroundDescriptor();
	const environment = getBackgroundEnvironment();

	return {
		descriptor,
		environment,
		logger: createBackgroundLogger(),
		storage: $storageKit,
		emit(event, payload) {
			postBackgroundMessage({
				type: "event",
				event,
				payload,
				at: new Date().toISOString(),
			});
		},
		postMessage(payload) {
			parentPort?.postMessage(payload);
		},
		onMessage(listener) {
			if (!parentPort) {
				return () => {};
			}

			const wrappedListener = (payload: unknown) => listener(payload);
			parentPort.on("message", wrappedListener);
			return () => {
				parentPort.off("message", wrappedListener);
			};
		},
		sleep(ms) {
			return sleep(ms);
		},
	};
}

export function postWorkerState(status: BackgroundWorkerStatus, detail?: string): void {
	postBackgroundMessage({
		type: "state",
		status,
		detail,
		at: new Date().toISOString(),
	});
}

export function defineBackgroundScript<THandler extends BackgroundScriptHandler>(handler: THandler): THandler {
	return handler;
}

export async function sleep(ms: number): Promise<void> {
	if (!Number.isFinite(ms) || ms < 0) {
		throw new Error(`Invalid sleep duration: ${ms}`);
	}

	await Bun.sleep(ms);
}