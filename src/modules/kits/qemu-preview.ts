import { defineExecutor, defineModule } from "../module";
import {
	createQemuPreviewReport,
	ensureQemuKit,
	parseOptionalString,
	resolveQemuPreset,
} from "./qemu-shared";

export type QemuPreviewParams = {
	target?: string;
};

export const qemuPreviewModule = defineModule<QemuPreviewParams>({
	id: "kits/qemu/preview",
	category: "kits",
	description: "Build a notebook-safe QEMU launch preview without starting the VM",
	consoleParams: [
		{
			name: "target",
			detail: "Preset id or unique name. Defaults to the only saved preset when exactly one exists.",
			example: "router",
			valueType: "string",
		},
	],
	executor: defineExecutor<QemuPreviewParams>(async (context) => {
		const kit = await ensureQemuKit(context, "Previewing QEMU preset");
		const target = parseOptionalString(context.params.target, "target");
		const preset = resolveQemuPreset(kit, target);
		const preview = kit.previewPreset(preset.id);
		return createQemuPreviewReport(preset, preview);
	}),
}).useDefault("target");