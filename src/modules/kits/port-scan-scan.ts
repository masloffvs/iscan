import { defineExecutor, defineModule } from "../module";
import {
	buildPortScanRunOptions,
	ensurePortScanKit,
	PORT_SCAN_NOTEBOOK_TYPE_OVERLAY,
	type PortScanScanParams,
} from "./port-scan-shared";

const PORT_SCAN_SCAN_CONSOLE_PARAMS = [
	{
		name: "host",
		detail: "Target hostname or IP address.",
		example: "127.0.0.1",
		required: true,
		valueType: "string",
	},
	{
		name: "ports",
		detail: "Explicit ports or ranges, for example 22,80,443 or 1-10000.",
		example: "1-10000",
		valueType: "string",
	},
	{
		name: "topPorts",
		detail: "Take the first N ports from the curated common-port preset.",
		example: "25",
		valueType: "number",
	},
	{
		name: "concurrency",
		detail: "Maximum number of concurrent socket attempts.",
		example: "500",
		valueType: "number",
	},
	{
		name: "connectTimeoutMs",
		detail: "Per-port connection timeout in milliseconds.",
		example: "500",
		valueType: "number",
	},
	{
		name: "persist",
		detail: "Reserved for history persistence. Defaults to true.",
		example: "true",
		valueType: "boolean",
	},
] as const;

export const portScanScanModule = defineModule<PortScanScanParams>({
	id: "kits/portScan/scan",
	category: "kits",
	description: "Run a bounded TCP connect scan against one host using explicit ports, ranges, or curated topPorts.",
	notebookTypeOverlay: PORT_SCAN_NOTEBOOK_TYPE_OVERLAY,
	consoleParams: PORT_SCAN_SCAN_CONSOLE_PARAMS,
	executor: defineExecutor<PortScanScanParams>(async (context) => {
		const kit = await ensurePortScanKit(context, "Running TCP port scan");
		return await kit.scan(buildPortScanRunOptions(context.params));
	}),
}).useDefault("host");