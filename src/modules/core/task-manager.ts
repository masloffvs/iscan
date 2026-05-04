import { createTableEntity, createTextEntity } from "../../primitives";
import type { BackgroundWorkerSnapshot } from "../../worker";
import { defineExecutor, defineModule } from "../module";

type TaskManagerRuntimeHelpers = {
	workers?: () => BackgroundWorkerSnapshot[];
};

function getWorkerSnapshots(runtime: { getHelpers(): object }): BackgroundWorkerSnapshot[] {
	const helpers = runtime.getHelpers() as TaskManagerRuntimeHelpers;
	return typeof helpers.workers === "function" ? helpers.workers() : [];
}

export const coreTaskManagerModule = defineModule({
	id: "core/task-manager",
	category: "core",
	description: "Inspect background workers",
	executor: defineExecutor(async ({ runtime }) => {
		const workers = getWorkerSnapshots(runtime);
		if (workers.length === 0) {
			return createTextEntity("No background workers are currently registered.");
		}

		return createTableEntity(
			[
				{ key: "name", header: "Worker", maxWidth: 28 },
				{ key: "status", header: "Status", maxWidth: 14 },
				{ key: "pid", header: "PID", maxWidth: 10 },
				{ key: "script", header: "Script", maxWidth: 42 },
			],
			workers.map(worker => ({
				name: worker.name,
				status: worker.status,
				pid: String(worker.pid || "-"),
				script: worker.relativeScriptPath,
			})),
			{ title: "Background workers" },
		);
	}),
});