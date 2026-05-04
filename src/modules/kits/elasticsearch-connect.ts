import { ElasticSearchKit } from "../../kits";
import { createTextEntity } from "../../primitives";
import { defineExecutor, defineModule, type ModuleConsoleParam } from "../module";

import { formatElasticIndex, readAuth, readDefaultIndex, readRequiredNode, type ElasticSearchConnectParams } from "./elastic-shared";

const ELASTIC_CONNECT_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "node",
		detail: "Elastic node URL.",
		valueType: "string",
		example: "node=http://127.0.0.1:9200",
		required: true,
	},
	{
		name: "index",
		detail: "Default index or comma-separated index list for reuse in the Activity.",
		valueType: "string",
		example: "index=logs-*",
	},
	{
		name: "username",
		detail: "Basic auth username.",
		valueType: "string",
		example: "username=elastic",
	},
	{
		name: "password",
		detail: "Basic auth password.",
		valueType: "string",
		example: "password=changeme",
	},
	{
		name: "apiKey",
		detail: "Elastic API key. Use instead of username/password or token.",
		valueType: "string",
		example: "apiKey=base64-key",
	},
	{
		name: "token",
		detail: "Bearer token. Use instead of other auth modes.",
		valueType: "string",
		example: "token=eyJ...",
	},
];

const executor = defineExecutor<ElasticSearchConnectParams>(async ({ params, runtime }) => {
	const node = readRequiredNode(params);
	const defaultIndex = readDefaultIndex(params);
	const auth = readAuth(params);
	const kit = new ElasticSearchKit({
		node,
		defaultIndex,
		auth,
	});

	const connectedKit = await runtime.attachKit(kit, {
		reason: "module:kits/elastic/connect",
	});
	const clusterInfo = connectedKit.getClusterInfo();

	return createTextEntity(
		[
			`ElasticSearchKit connected`,
			`Node: ${connectedKit.getNode()}`,
			`Index: ${formatElasticIndex(connectedKit.getDefaultIndex())}`,
			`Cluster: ${clusterInfo?.cluster_name ?? clusterInfo?.name ?? "unknown"}`,
		],
		{ tone: "info" },
	);
});

export const elasticSearchConnectModule = defineModule({
	id: "kits/elastic/connect",
	category: "kits",
	description: "Connect an Activity-scoped ElasticSearchKit instance for reuse inside the current Activity",
	consoleParams: ELASTIC_CONNECT_CONSOLE_PARAMS,
	executor,
}).useDefault("node");