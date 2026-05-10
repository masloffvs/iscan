import { InvalidParamsError } from "../errors";
import { defineExecutor, defineModule } from "../module";
import {
	ensurePortScanKit,
	parseOptionalString,
	PORT_SCAN_NOTEBOOK_TYPE_OVERLAY,
	type PortScanGetParams,
} from "./port-scan-shared";

const PORT_SCAN_GET_CONSOLE_PARAMS = [
	{
		name: "scanId",
		detail: "Persisted scan id returned by kits/portScan/scan.",
		example: "2b2ab0d1-29d8-4cde-a085-31c1c8436108",
		required: true,
		valueType: "string",
	},
] as const;

export const portScanGetModule = defineModule<PortScanGetParams>({
	id: "kits/portScan/get",
	category: "kits",
	description: "Load one persisted TCP port scan run by scan id.",
	notebookTypeOverlay: PORT_SCAN_NOTEBOOK_TYPE_OVERLAY,
	consoleParams: PORT_SCAN_GET_CONSOLE_PARAMS,
	executor: defineExecutor<PortScanGetParams>(async (context) => {
		const scanId = parseOptionalString(context.params.scanId, "scanId");
		if (!scanId) {
			throw new InvalidParamsError("scanId is required.");
		}

		const kit = await ensurePortScanKit(context, `Loading persisted port scan ${scanId}`);
		return {
			scan: await kit.getScan(scanId),
		};
	}),
}).useDefault("scanId");