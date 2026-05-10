import { pathToFileURL } from "node:url";
import { resourceLimits } from "node:worker_threads";

import { createBackgroundScriptContext, getBackgroundDescriptor, getBackgroundMetricsIntervalMs, postWorkerState, type BackgroundScriptHandler } from "./api";
import type { BackgroundWorkerMemoryUsage, BackgroundWorkerMetrics, BackgroundWorkerResourceLimits } from "./types";

type BackgroundScriptModule = {
	default?: BackgroundScriptHandler;
	run?: BackgroundScriptHandler;
};

function formatWorkerError(error: unknown): string {
	if (error instanceof Error) {
		return `${error.name}: ${error.message}`;
	}

	return String(error);
}

function roundMegabytes(bytes: number): number {
	return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function readMemoryUsage(): BackgroundWorkerMemoryUsage {
	const usage = process.memoryUsage();
	return {
		rssMb: roundMegabytes(usage.rss),
		heapTotalMb: roundMegabytes(usage.heapTotal),
		heapUsedMb: roundMegabytes(usage.heapUsed),
		externalMb: roundMegabytes(usage.external),
		arrayBuffersMb: roundMegabytes(usage.arrayBuffers),
	};
}

function readResourceLimits(): BackgroundWorkerResourceLimits {
	return {
		maxYoungGenerationSizeMb: resourceLimits.maxYoungGenerationSizeMb,
		maxOldGenerationSizeMb: resourceLimits.maxOldGenerationSizeMb,
		codeRangeSizeMb: resourceLimits.codeRangeSizeMb,
		stackSizeMb: resourceLimits.stackSizeMb,
	};
}

function buildMetrics(startedAtMs: number): BackgroundWorkerMetrics {
	return {
		resourceLimits: readResourceLimits(),
		memoryUsage: readMemoryUsage(),
		uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
	};
}

function postMetrics(startedAtMs: number): void {
	const now = new Date().toISOString();
	postMessage({
		type: "metrics",
		at: now,
		metrics: buildMetrics(startedAtMs),
	});
}

async function main(): Promise<void> {
	const descriptor = getBackgroundDescriptor();
	const context = createBackgroundScriptContext();
	const startedAtMs = Date.now();
	const metricsIntervalMs = getBackgroundMetricsIntervalMs();
	const metricsInterval = setInterval(() => {
		postMetrics(startedAtMs);
	}, metricsIntervalMs);

	try {
		postWorkerState("running", `Loading ${descriptor.relativeScriptPath}`);
		postMetrics(startedAtMs);
		const scriptModule = await import(pathToFileURL(descriptor.scriptPath).href) as BackgroundScriptModule;
		const handler = typeof scriptModule.default === "function"
			? scriptModule.default
			: (typeof scriptModule.run === "function" ? scriptModule.run : null);

		if (!handler) {
			postWorkerState("stopped", "No background script handler exported.");
			return;
		}

		await handler(context);
		postWorkerState("stopped", "Worker completed.");
	} finally {
		clearInterval(metricsInterval);
	}
}

let fatalWorkerShutdownScheduled = false;

function handleFatalWorkerError(error: unknown): void {
	if (fatalWorkerShutdownScheduled) {
		return;
	}

	fatalWorkerShutdownScheduled = true;
	postWorkerState("error", formatWorkerError(error));
	process.exitCode = 1;
	setTimeout(() => {
		process.exit(1);
	}, 0);
}

process.on("unhandledRejection", (error) => {
	handleFatalWorkerError(error);
});

process.on("uncaughtException", (error) => {
	handleFatalWorkerError(error);
});

try {
	await main();
} catch (error) {
	handleFatalWorkerError(error);
}