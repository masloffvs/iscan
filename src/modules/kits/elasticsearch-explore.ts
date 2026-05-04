import { createTableEntity, createTextEntity, type OutputEntity } from "../../primitives";
import { defineExecutor, defineModule, type ModuleConsoleParam } from "../module";

import { formatElasticIndex, stringifyElasticValue } from "./elastic-shared";

export type ElasticSearchExploreParams = {
	level?: "cluster" | "indices" | "shards";
};

const ELASTIC_EXPLORE_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "level",
		detail: "Requested inspection depth for the Elastic environment.",
		valueType: "string",
		values: ["cluster", "indices", "shards"],
		example: "level=cluster",
	},
];

function toExploreRows(values: Array<{ key: string; value: unknown }>) {
	return values.map(entry => ({
		key: entry.key,
		value: stringifyElasticValue(entry.value),
	}));
}

const executor = defineExecutor<ElasticSearchExploreParams>(async ({ module, requireElasticSearchKit, runtime }) => {
	const kit = requireElasticSearchKit();
	const clusterInfo = kit.getClusterInfo() ?? await kit.connect();
	const health = await kit.getClusterHealth();

	const outputs: OutputEntity[] = [
		createTextEntity(
			[
				"Elastic explore",
				`Module: ${module.id}`,
				`Connection: ${kit.getConnectionSummary()}`,
				`Active kits: ${runtime.listKits().map(activeKit => activeKit.id).join(",") || "<none>"}`,
			],
			{ tone: "info" },
		),
		createTableEntity(
			[
				{ key: "key", header: "Key", maxWidth: 26 },
				{ key: "value", header: "Value", maxWidth: 72 },
			],
			toExploreRows([
				{ key: "node", value: kit.getNode() },
				{ key: "defaultIndex", value: formatElasticIndex(kit.getDefaultIndex()) },
				{ key: "clusterName", value: clusterInfo.cluster_name ?? clusterInfo.name ?? "unknown" },
				{ key: "clusterUuid", value: clusterInfo.cluster_uuid ?? "unknown" },
				{ key: "version", value: clusterInfo.version?.number ?? "unknown" },
				{ key: "status", value: health.status ?? "unknown" },
				{ key: "nodes", value: health.number_of_nodes ?? "unknown" },
				{ key: "dataNodes", value: health.number_of_data_nodes ?? "unknown" },
				{ key: "activePrimaryShards", value: health.active_primary_shards ?? 0 },
				{ key: "activeShards", value: health.active_shards ?? 0 },
				{ key: "unassignedShards", value: health.unassigned_shards ?? 0 },
			]),
			{ title: "Elastic environment" },
		),
	];

	return outputs;
});

export const elasticSearchExploreModule = defineModule({
	id: "kits/elastic/explore",
	category: "kits",
	description: "Inspect the current Activity-scoped ElasticSearch environment and show where you are connected",
	consoleParams: ELASTIC_EXPLORE_CONSOLE_PARAMS,
	executor,
});