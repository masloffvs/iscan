import type { ElasticSearchSearchBody } from "../../kits";
import { createTableEntity, createTextEntity, type OutputEntity } from "../../primitives";
import { InvalidParamsError } from "../errors";
import { defineExecutor, defineModule, type ModuleConsoleParam } from "../module";

import { formatElasticIndex, stringifyElasticValue, truncateValue } from "./elastic-shared";

export type ElasticSearchSearchParams = {
	index?: string;
	query?: string;
	body?: ElasticSearchSearchBody;
	size?: number;
	from?: number;
	sort?: string | string[];
	source?: boolean | string | string[];
	trackTotalHits?: boolean | number;
};

const ELASTIC_SEARCH_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "query",
		detail: "Lucene query_string expression. If omitted, match_all is used.",
		valueType: "string",
		example: "query=status:500 AND service:web",
	},
	{
		name: "index",
		detail: "Override default index with one or more comma-separated indexes.",
		valueType: "string",
		example: "index=logs-*,metrics-*",
	},
	{
		name: "size",
		detail: "Number of hits to return.",
		valueType: "number",
		example: "size=25",
	},
	{
		name: "from",
		detail: "Offset for pagination.",
		valueType: "number",
		example: "from=0",
	},
	{
		name: "sort",
		detail: "Sort expression or comma-separated sort list.",
		valueType: "string",
		example: "sort=@timestamp:desc",
	},
	{
		name: "source",
		detail: "Boolean or field list controlling _source inclusion.",
		example: "source=message,@timestamp",
	},
	{
		name: "trackTotalHits",
		detail: "Boolean or numeric track_total_hits setting.",
		example: "trackTotalHits=true",
	},
	{
		name: "body",
		detail: "Raw JSON search body. Overrides implicit query builder fields when provided.",
		valueType: "json",
		example: 'body={"query":{"match_all":{}}}',
	},
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonNegativeInteger(value: unknown, paramName: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new InvalidParamsError(`Param '${paramName}' must be a non-negative integer.`);
	}

	return value;
}

function buildSearchBody(params: ElasticSearchSearchParams): ElasticSearchSearchBody {
	const baseBody = params.body;
	if (baseBody !== undefined && !isRecord(baseBody)) {
		throw new InvalidParamsError("Param 'body' must be an object-like JSON payload.");
	}

	const body: ElasticSearchSearchBody = baseBody
		? structuredClone(baseBody)
		: (typeof params.query === "string" && params.query.trim().length > 0
			? {
				query: {
					query_string: {
						query: params.query.trim(),
					},
				},
			}
			: {
				query: {
					match_all: {},
				},
			});

	const size = readNonNegativeInteger(params.size, "size");
	const from = readNonNegativeInteger(params.from, "from");
	if (size !== undefined) {
		body.size = size;
	}
	if (from !== undefined) {
		body.from = from;
	}
	if (params.sort !== undefined) {
		body.sort = Array.isArray(params.sort) ? params.sort : [params.sort];
	}
	if (params.source !== undefined) {
		body._source = Array.isArray(params.source)
			? params.source
			: (typeof params.source === "string" && params.source.includes(",")
				? params.source.split(",").map(value => value.trim()).filter(Boolean)
				: params.source);
	}
	if (params.trackTotalHits !== undefined) {
		body.track_total_hits = params.trackTotalHits;
	}

	return body;
}

function normalizeSearchIndexes(index: string | undefined): string[] | undefined {
	if (typeof index !== "string" || index.trim().length === 0) {
		return undefined;
	}

	const indexes = index.split(",").map(value => value.trim()).filter(Boolean);
	return indexes.length > 0 ? indexes : undefined;
}

const executor = defineExecutor<ElasticSearchSearchParams>(async ({ params, requireElasticSearchKit }) => {
	const kit = requireElasticSearchKit();
	const body = buildSearchBody(params);
	const index = normalizeSearchIndexes(params.index);
	const response = await kit.search(body, { index });
	const hits = response.hits.hits;
	const total = typeof response.hits.total === "number"
		? response.hits.total
		: (response.hits.total?.value ?? hits.length);

	const outputs: OutputEntity[] = [
		createTextEntity(
			[
				"Elastic search",
				`Node: ${kit.getNode()}`,
				`Index: ${formatElasticIndex(index ?? kit.getDefaultIndex())}`,
				`Hits: ${total}`,
				`Took: ${response.took ?? "unknown"} ms`,
			],
			{ tone: "info" },
		),
	];

	if (hits.length === 0) {
		outputs.push(createTextEntity("No search hits returned.", { tone: "muted" }));
		return outputs;
	}

	outputs.push(
		createTableEntity(
			[
				{ key: "index", header: "Index", maxWidth: 20 },
				{ key: "id", header: "Id", maxWidth: 24 },
				{ key: "score", header: "Score", align: "right", maxWidth: 8 },
				{ key: "source", header: "Source", maxWidth: 64 },
			],
			hits.map(hit => ({
				index: hit._index,
				id: hit._id,
				score: hit._score ?? "-",
				source: truncateValue(stringifyElasticValue(hit._source ?? hit.fields ?? {}), 120),
			})),
			{ title: "Elastic search hits" },
		),
	);

	return outputs;
});

export const elasticSearchSearchModule = defineModule({
	id: "kits/elastic/search",
	category: "kits",
	description: "Search the current Activity-scoped ElasticSearch connection using a query string or raw body",
	consoleParams: ELASTIC_SEARCH_CONSOLE_PARAMS,
	executor,
}).useDefault("query");