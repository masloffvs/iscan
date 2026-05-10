import { defineExecutor, defineModule } from "../module";
import {
	ensurePortScanKit,
	PORT_SCAN_NOTEBOOK_TYPE_OVERLAY,
} from "./port-scan-shared";

export const portScanPolicyModule = defineModule({
	id: "kits/portScan/policy",
	category: "kits",
	description: "Show effective host policy, defaults, and call examples for the TCP port scan kit.",
	notebookTypeOverlay: PORT_SCAN_NOTEBOOK_TYPE_OVERLAY,
	executor: defineExecutor(async (context) => {
		const kit = await ensurePortScanKit(context, "Inspecting port scan policy");
		return kit.getPolicySnapshot();
	}),
});