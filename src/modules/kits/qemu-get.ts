import { defineExecutor, defineModule } from "../module";
import {
	createQemuPresetDetailReport,
	ensureQemuKit,
	parseOptionalString,
	QEMU_NOTEBOOK_TYPE_OVERLAY,
	resolveQemuPreset,
} from "./qemu-shared";

export type QemuGetParams = {
	target?: string;
};

export const qemuGetModule = defineModule<QemuGetParams>({
	id: "kits/qemu/get",
	category: "kits",
	description: "Inspect one saved QEMU preset by id or unique name",
	notebookTypeOverlay: QEMU_NOTEBOOK_TYPE_OVERLAY,
	consoleParams: [
		{
			name: "target",
			detail: "Preset id or unique name. Defaults to the only saved preset when exactly one exists.",
			example: "router",
			valueType: "string",
		},
	],
	executor: defineExecutor<QemuGetParams>(async (context) => {
		const kit = await ensureQemuKit(context, "Inspecting QEMU preset");
		const target = parseOptionalString(context.params.target, "target");
		const preset = resolveQemuPreset(kit, target);
		return createQemuPresetDetailReport(preset);
	}),
}).useDefault("target");