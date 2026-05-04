import { defineExecutor, defineModule } from "../module";
import {
	createQemuPresetDeleteReport,
	ensureQemuKit,
	parseOptionalString,
	resolveQemuPreset,
} from "./qemu-shared";

export type QemuDeleteParams = {
	target?: string;
};

export const qemuDeleteModule = defineModule<QemuDeleteParams>({
	id: "kits/qemu/delete",
	category: "kits",
	description: "Delete a saved QEMU preset by id or unique name",
	consoleParams: [
		{
			name: "target",
			detail: "Preset id or unique name. Defaults to the only saved preset when exactly one exists.",
			example: "router",
			valueType: "string",
		},
	],
	executor: defineExecutor<QemuDeleteParams>(async (context) => {
		const kit = await ensureQemuKit(context, "Deleting QEMU preset");
		const target = parseOptionalString(context.params.target, "target");
		const preset = resolveQemuPreset(kit, target);
		await kit.deletePreset(preset.id);
		return createQemuPresetDeleteReport(kit, preset);
	}),
}).useDefault("target");