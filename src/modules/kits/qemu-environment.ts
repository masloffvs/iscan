import { defineExecutor, defineModule } from "../module";
import { createQemuEnvironmentReport, ensureQemuKit } from "./qemu-shared";

export const qemuEnvironmentModule = defineModule({
	id: "kits/qemu/environment",
	category: "kits",
	description: "Inspect the current QEMU dependency and configuration state for the Activity",
	executor: defineExecutor(async (context) => {
		const kit = await ensureQemuKit(context, "Inspecting QEMU environment");
		return createQemuEnvironmentReport(kit.inspectEnvironment());
	}),
});