import { createTableEntity, createTextEntity, type OutputEntity } from "../../primitives";
import { defineExecutor, defineModule } from "../module";
import {
	normalizeMatchPort,
	type ZoomEyeMatch,
	type ZoomEyePullExecutionResult,
	type ZoomEyePullParams,
	type ZoomEyeSearchableField,
	type ZoomEyeSelectParams,
	ZOOMEYE_PULL_CONSOLE_PARAMS,
	ZOOMEYE_SELECT_CONSOLE_PARAMS,
	executeZoomEyePull,
	executeZoomEyeSelect,
} from "./zoomeye.shared";

function createSummaryEntity(result: ZoomEyePullExecutionResult): OutputEntity {
	return createTextEntity(
		[
			"ZoomEye pull",
			`User: ${result.authenticatedUser}`,
			`Query (base64): ${result.queryBase64}`,
			`Query (decoded): ${result.queryText ?? "<unavailable>"}`,
			`Search type: ${result.searchType}`,
			`Pages fetched: ${result.pagesFetched} starting at page ${result.startPage}`,
			`Page size: ${result.pageSize}`,
			`Raw matches: ${result.rawMatches}`,
			`Unique ip:port rows in batch: ${result.uniqueMatches}`,
			`Inserted: ${result.inserted}`,
			`Updated: ${result.updated}`,
			`Fetched at: ${result.fetchedAt}`,
			`Cloak profile: ${result.cloakProfileLabel}`,
		],
		{ tone: "info" },
	);
}

function createMatchesTable(matches: readonly ZoomEyeMatch[]): OutputEntity {
	if (matches.length === 0) {
		return createTextEntity("No ZoomEye matches were returned.", { tone: "muted" });
	}

	return createTableEntity(
		[
			{ key: "endpoint", header: "Endpoint", maxWidth: 24 },
			{ key: "service", header: "Service", maxWidth: 14 },
			{ key: "product", header: "Product", maxWidth: 22 },
			{ key: "organization", header: "Org", maxWidth: 24 },
			{ key: "location", header: "Location", maxWidth: 22 },
			{ key: "body", header: "Body", maxWidth: 32 },
		],
		matches.map((match) => ({
			endpoint: `${match.ip ?? "unknown"}:${normalizeMatchPort(match) ?? "?"}`,
			service: [match.portinfo?.service, match.portinfo?.transport].filter(Boolean).join("/") || "",
			product: match.portinfo?.product ?? "",
			organization: match.geoinfo?.organization ?? "",
			location: [match.geoinfo?.city?.names?.en, match.geoinfo?.subdivisions?.names?.en, match.geoinfo?.country?.code].filter(Boolean).join(", "),
			body: match.body ?? "",
		})),
		{ title: `ZoomEye matches preview (${matches.length})` },
	);
}

function createSelectResultsTable(
	rows: ReturnType<typeof executeZoomEyeSelect>["matches"],
	pattern: string,
	field: ZoomEyeSearchableField | null,
): OutputEntity {
	if (rows.length === 0) {
		return createTextEntity(
			`No ZoomEye hosts matched pattern /${pattern}/i${field ? ` in field '${field}'` : ""}.`,
			{ tone: "muted" },
		);
	}

	return createTableEntity(
		[
			{ key: "endpoint", header: "Endpoint", maxWidth: 24 },
			{ key: "service", header: "Service", maxWidth: 14 },
			{ key: "product", header: "Product", maxWidth: 22 },
			{ key: "hostname", header: "Hostname", maxWidth: 28 },
			{ key: "organization", header: "Org", maxWidth: 24 },
			{ key: "title", header: "Title", maxWidth: 32 },
		],
		rows.map((row) => ({
			endpoint: `${row.ip}:${row.port}`,
			service: [row.service, row.transport].filter(Boolean).join("/") || "",
			product: row.product ?? "",
			hostname: row.hostname ?? "",
			organization: row.organization ?? "",
			title: row.title ?? "",
		})),
		{ title: `ZoomEye select (${rows.length} match${rows.length === 1 ? "" : "es"})` },
	);
}

const pullExecutor = defineExecutor<ZoomEyePullParams>(async (context) => {
	const result = await executeZoomEyePull(context.runtime, context.logger, context.params);

	return [
		createSummaryEntity(result),
		createMatchesTable(result.previewMatches),
	];
});

const selectExecutor = defineExecutor<ZoomEyeSelectParams>((context) => {
	const result = executeZoomEyeSelect(context.runtime, context.params);

	return [
		createTextEntity(
			[
				`Pattern: /${result.pattern}/i`,
				`Field: ${result.field ?? "(all text fields)"}`,
				`Scanned: ${result.scannedRows} rows`,
				`Matched: ${result.matches.length}`,
			],
			{ tone: result.matches.length > 0 ? "info" : "muted" },
		),
		createSelectResultsTable(result.matches, result.pattern, result.field),
	];
});

export const zoomEyePullModule = defineModule({
	id: "discovery/zoomeye/pull",
	category: "discovery",
	description: "Reuse an authenticated CloakBrowser profile for ZoomEye, fetch paged search results, and store unique ip:port hosts in SQLite",
	consoleParams: ZOOMEYE_PULL_CONSOLE_PARAMS,
	executor: pullExecutor,
}).useDefault("queryBase64");

export const zoomEyeSelectModule = defineModule({
	id: "discovery/zoomeye/select",
	category: "discovery",
	description: "Search stored ZoomEye hosts in SQLite by regex pattern across one or all text fields",
	consoleParams: ZOOMEYE_SELECT_CONSOLE_PARAMS,
	executor: selectExecutor,
}).useDefault("pattern");

export type { ZoomEyePullParams, ZoomEyeSelectParams } from "./zoomeye.shared";