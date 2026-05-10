import { defineExecutor, defineModule } from "../module";
import { createQemuPresetListReport, ensureQemuKit, QEMU_NOTEBOOK_TYPE_OVERLAY } from "./qemu-shared";

export const qemuListModule = defineModule({
	id: "kits/qemu/list",
	category: "kits",
	description: "List saved QEMU presets for the current Activity",
	notebookTypeOverlay: QEMU_NOTEBOOK_TYPE_OVERLAY,
	executor: defineExecutor(async (context) => {
		const kit = await ensureQemuKit(context, "Listing QEMU presets");
		return createQemuPresetListReport(kit);
	}),
});