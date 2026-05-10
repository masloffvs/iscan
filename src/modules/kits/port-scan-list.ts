import { defineExecutor, defineModule } from "../module";
import {
	ensurePortScanKit,
	parseOptionalNonNegativeInteger,
	parseOptionalPositiveInteger,
	parseOptionalString,
	PORT_SCAN_NOTEBOOK_TYPE_OVERLAY,
	type PortScanListParams,
} from "./port-scan-shared";

const PORT_SCAN_LIST_CONSOLE_PARAMS = [
	{
		name: "host",
		detail: "Optional host filter for persisted scan history.",
		example: "127.0.0.1",
		valueType: "string",
	},
	{
		name: "limit",
		detail: "Maximum number of saved scans to return.",
		example: "25",
		valueType: "number",
	},
	{
		name: "offset",
		detail: "Row offset for pagination.",
		example: "0",
		valueType: "number",
	},
] as const;

export const portScanListModule = defineModule<PortScanListParams>({
	id: "kits/portScan/list",
	category: "kits",
	description: "List persisted TCP port scan runs, optionally filtered by host.",
	notebookTypeOverlay: PORT_SCAN_NOTEBOOK_TYPE_OVERLAY,
	consoleParams: PORT_SCAN_LIST_CONSOLE_PARAMS,
	executor: defineExecutor<PortScanListParams>(async (context) => {
		const kit = await ensurePortScanKit(context, "Listing persisted port scans");
		const filters = {
			host: parseOptionalString(context.params.host, "host"),
			limit: parseOptionalPositiveInteger(context.params.limit, "limit"),
			offset: parseOptionalNonNegativeInteger(context.params.offset, "offset"),
		};

		return {
			filters,
			scans: await kit.listScans(filters),
		};
	}),
});