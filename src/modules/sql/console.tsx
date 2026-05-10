import React, { useDeferredValue, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

import { $storageKit, type StorageKit } from "../../kits";
import { InvalidParamsError } from "../errors";
import { defineExecutor, type InteractiveApplicationProps, type ModuleConsoleParam, type ModuleExecutionContext } from "../module";

type StorageSqlClient = {
	query(sql: string): {
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
		run(...params: unknown[]): {
			changes: number;
			lastInsertRowid?: number | bigint;
		};
	};
	exec(sql: string): void;
};

export type SqlTableColumn = {
	name: string;
	type: string;
	notNull: boolean;
	primaryKey: boolean;
};

export type SqlTableSummary = {
	name: string;
	kind: "table" | "view";
	rowCount: number;
	columns: SqlTableColumn[];
	sampleValues: Record<string, string[]>;
};

export type SqlSchemaSnapshot = {
	tables: SqlTableSummary[];
	refreshedAt: string;
};

type SqlSuggestionKind = "snippet" | "keyword" | "table" | "column" | "value";

type SqlSuggestion = {
	label: string;
	insertText: string;
	detail: string;
	kind: SqlSuggestionKind;
};

export type SqlNotebookCompletionItem = {
	value: string;
	label?: string;
	detail?: string;
	kind: "command";
};

export type SqlExecutionResult =
	| {
		kind: "rows";
		columns: string[];
		rows: Record<string, unknown>[];
		truncated: boolean;
		elapsedMs: number;
	}
	| {
		kind: "write";
		changes: number;
		lastInsertRowid: number | null;
		elapsedMs: number;
	}
	| {
		kind: "message";
		text: string;
		elapsedMs: number;
	};

export type SqlModuleParams = {
	query?: string;
};

export type SqlModuleQueryResult = {
	rows: Record<string, unknown>[];
	columns: string[];
	meta: {
		kind: SqlExecutionResult["kind"];
		elapsedMs: number;
		truncated?: boolean;
		changes?: number;
		lastInsertRowid?: number | null;
		text?: string;
	};
};

export const SQL_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "query",
		detail: "SQL statement to execute directly instead of opening the interactive SQL console.",
		valueType: "string",
		example: "query=select 1 as x",
	},
] as const;

type SqlConsoleEntry = {
	kind: "command" | "output" | "info" | "error";
	text: string;
};

type SqlConsoleAppProps = InteractiveApplicationProps & {
	databasePath: string;
	promptLabel: string;
	initialSchema: SqlSchemaSnapshot;
	executeQuery(query: string): Promise<SqlExecutionResult>;
	refreshSchema(): Promise<SqlSchemaSnapshot>;
};

type SqlModuleContext = ModuleExecutionContext<SqlModuleParams, object>;

type SqlTableAlias = {
	alias: string;
	table: string;
	description: string;
};

type SqlReferencedTable = {
	table: SqlTableSummary;
	qualifiers: Set<string>;
};

const SQL_KEYWORDS = [
	"SELECT",
	"FROM",
	"WHERE",
	"JOIN",
	"LEFT JOIN",
	"RIGHT JOIN",
	"INNER JOIN",
	"ORDER BY",
	"GROUP BY",
	"LIMIT",
	"OFFSET",
	"INSERT INTO",
	"UPDATE",
	"DELETE FROM",
	"CREATE TABLE",
	"DROP TABLE",
	"ALTER TABLE",
	"PRAGMA",
	"VALUES",
	"DISTINCT",
	"COUNT(*)",
] as const;

const SQL_KEYWORD_SET = new Set(SQL_KEYWORDS.map((keyword) => keyword.toUpperCase()));

const MAX_SUGGESTIONS = 8;
const MAX_RESULT_ROWS = 256;
const MAX_SAMPLE_VALUES = 3;
const MAX_TRANSCRIPT_ITEMS = 120;
const SQL_TABLE_ALIASES: readonly SqlTableAlias[] = [
	{
		alias: "zoomeye",
		table: "zoomeye_hosts",
		description: "ZoomEye host records stored in StorageKit",
	},
	{
		alias: "workers",
		table: "worker_logs",
		description: "Background worker log records",
	},
] as const;

function getStorageClient(storageKit: StorageKit): StorageSqlClient {
	return storageKit.db.$client as StorageSqlClient;
}

export async function ensureStorageKit(context: Pick<SqlModuleContext, "getStorageKit" | "runtime">): Promise<StorageKit> {
	const existingKit = context.getStorageKit();
	if (existingKit) {
		return existingKit;
	}

	return await context.runtime.attachKit($storageKit, {
		reason: "module:sql",
	});
}

function quoteIdentifier(value: string): string {
	return `"${value.replace(/"/gu, '""')}"`;
}

function quoteStringLiteral(value: string): string {
	return `'${value.replace(/'/gu, "''")}'`;
}

export function normalizeScalarValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "NULL";
	}

	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function getAvailableTableAliases(schema: SqlSchemaSnapshot): SqlTableAlias[] {
	const availableTables = new Set(schema.tables.map((table) => table.name));
	return SQL_TABLE_ALIASES.filter((alias) => availableTables.has(alias.table));
}

function resolveAliasedTableName(tableName: string, schema: SqlSchemaSnapshot): string {
	const normalized = tableName.trim().replace(/^['"`]|['"`]$/gu, "");
	const alias = getAvailableTableAliases(schema).find((candidate) => candidate.alias === normalized.toLowerCase());
	return alias?.table ?? normalized;
}

export function getAliasForTable(tableName: string, schema: SqlSchemaSnapshot): SqlTableAlias | null {
	return getAvailableTableAliases(schema).find((alias) => alias.table === tableName) ?? null;
}

export function rewriteQueryTableAliases(query: string, schema: SqlSchemaSnapshot): string {
	let rewritten = query;

	for (const alias of getAvailableTableAliases(schema)) {
		const escapedAlias = alias.alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
		const tableContextPattern = new RegExp(`\\b(FROM|JOIN|UPDATE|INTO|TABLE)\\s+${escapedAlias}\\b`, "giu");
		const pragmaPattern = new RegExp(`(\\bPRAGMA\\s+table_info\\(\\s*['"\\x60]?)${escapedAlias}(['"\\x60]?\\s*\\))`, "giu");
		rewritten = rewritten
			.replace(tableContextPattern, `$1 ${alias.table}`)
			.replace(pragmaPattern, `$1${alias.table}$2`);
	}

	return rewritten;
}

function wrapText(text: string, width: number): string[] {
	const safeWidth = Math.max(8, width);
	const paragraphs = text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n");
	const lines: string[] = [];

	for (const paragraph of paragraphs) {
		if (paragraph.length === 0) {
			lines.push("");
			continue;
		}

		let remaining = paragraph;
		while (remaining.length > safeWidth) {
			const slice = remaining.slice(0, safeWidth);
			const breakIndex = slice.lastIndexOf(" ");
			const splitIndex = breakIndex >= Math.floor(safeWidth / 3) ? breakIndex : safeWidth;
			lines.push(remaining.slice(0, splitIndex).trimEnd());
			remaining = remaining.slice(splitIndex).trimStart();
		}

		lines.push(remaining);
	}

	return lines.length > 0 ? lines : [""];
}

function truncateCell(text: string, width: number): string {
	if (text.length <= width) {
		return text.padEnd(width, " ");
	}

	if (width <= 1) {
		return text.slice(0, width);
	}

	return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function createInputViewport(value: string, cursorOffset: number, width: number): { left: string; cursor: string; right: string } {
	const safeWidth = Math.max(1, width);
	const boundedCursor = Math.max(0, Math.min(cursorOffset, value.length));
	let start = Math.max(0, boundedCursor - safeWidth + 1);
	const end = Math.min(value.length, start + safeWidth);

	if (end - start < safeWidth && start > 0) {
		start = Math.max(0, end - safeWidth);
	}

	const visible = value.slice(start, end);
	const visibleCursor = boundedCursor - start;
	const left = visible.slice(0, visibleCursor);
	const cursor = visible.slice(visibleCursor, visibleCursor + 1) || " ";
	const right = visible.slice(visibleCursor + 1);

	return { left, cursor, right };
}

function flattenEntries(entries: readonly SqlConsoleEntry[], width: number): Array<{ text: string; color: string }> {
	const rendered: Array<{ text: string; color: string }> = [];
	const bodyWidth = Math.max(12, width - 2);

	for (const entry of entries) {
		const prefix = entry.kind === "command"
			? ""
			: entry.kind === "error"
				? "err> "
				: entry.kind === "info"
					? "info> "
					: "out> ";
		const color = entry.kind === "command"
			? "#34d399"
			: entry.kind === "error"
				? "#f87171"
				: entry.kind === "info"
					? "#fbbf24"
					: "#e5e7eb";
		const wrapped = wrapText(entry.text, Math.max(8, bodyWidth - prefix.length));

		wrapped.forEach((line, index) => {
			rendered.push({
				text: `${index === 0 ? prefix : " ".repeat(prefix.length)}${line}`,
				color,
			});
		});
	}

	return rendered;
}

function readStatementKeyword(query: string): string {
	return query
		.trimStart()
		.replace(/^(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)+/u, "")
		.trimStart()
		.split(/\s+/u)[0]?.toUpperCase() ?? "";
}

function isReadQuery(query: string): boolean {
	const keyword = readStatementKeyword(query);
	if (keyword === "SELECT" || keyword === "PRAGMA" || keyword === "EXPLAIN" || keyword === "VALUES") {
		return true;
	}

	if (keyword === "WITH") {
		return !/\b(?:INSERT|UPDATE|DELETE)\b/iu.test(query);
	}

	return false;
}

function extractRowColumns(rows: readonly Record<string, unknown>[]): string[] {
	const seen = new Set<string>();
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			if (!seen.has(key)) {
				seen.add(key);
			}
		}
	}

	return [...seen];
}

function formatRows(rows: readonly Record<string, unknown>[], width: number): string {
	if (rows.length === 0) {
		return "0 rows";
	}

	const columns = extractRowColumns(rows);
	if (columns.length === 0) {
		return `${rows.length} rows`;
	}

	const availableWidth = Math.max(24, width - 4);
	const maxColumnWidth = Math.max(8, Math.min(24, Math.floor((availableWidth - Math.max(0, columns.length - 1) * 3) / columns.length)));
	const visibleColumns: string[] = [];
	let usedWidth = 0;

	for (const column of columns) {
		const nextWidth = usedWidth === 0 ? maxColumnWidth : usedWidth + 3 + maxColumnWidth;
		if (nextWidth > availableWidth && visibleColumns.length > 0) {
			break;
		}

		visibleColumns.push(column);
		usedWidth = nextWidth;
	}

	const widths = visibleColumns.map((column) => {
		const candidateLengths = rows.slice(0, 8).map((row) => normalizeScalarValue(row[column]).length);
		return Math.max(
			Math.min(maxColumnWidth, column.length),
			Math.min(maxColumnWidth, ...candidateLengths),
		);
	});

	const header = visibleColumns.map((column, index) => truncateCell(column, widths[index] ?? maxColumnWidth)).join(" | ");
	const divider = widths.map((columnWidth) => "-".repeat(columnWidth)).join("-+-");
	const body = rows.map((row) => visibleColumns
		.map((column, index) => truncateCell(normalizeScalarValue(row[column]), widths[index] ?? maxColumnWidth))
		.join(" | "));
	const hiddenColumns = columns.length - visibleColumns.length;

	return [
		header,
		divider,
		...body,
		hiddenColumns > 0 ? `... ${hiddenColumns} more column(s)` : null,
	].filter((line): line is string => Boolean(line)).join("\n");
}

export function findTableByName(schema: SqlSchemaSnapshot, tableName: string): SqlTableSummary | null {
	const normalized = resolveAliasedTableName(tableName, schema);
	return schema.tables.find((table) => table.name === normalized) ?? null;
}

function isSqlKeyword(value: string): boolean {
	return SQL_KEYWORD_SET.has(value.trim().toUpperCase());
}

function extractReferencedTableBindings(input: string, schema: SqlSchemaSnapshot): SqlReferencedTable[] {
	const references = new Map<string, SqlReferencedTable>();
	const pattern = /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:"([^"]+)"|`([^`]+)`|'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/giu;

	for (const match of input.matchAll(pattern)) {
		const tableName = match[1] ?? match[2] ?? match[3] ?? match[4];
		if (!tableName) {
			continue;
		}

		const table = findTableByName(schema, tableName);
		if (!table) {
			continue;
		}

		const existing = references.get(table.name);
		const reference = existing ?? {
			table,
			qualifiers: new Set<string>(),
		};

		reference.qualifiers.add(table.name.toLowerCase());
		reference.qualifiers.add(tableName.toLowerCase());

		const logicalAlias = getAliasForTable(table.name, schema)?.alias;
		if (logicalAlias) {
			reference.qualifiers.add(logicalAlias.toLowerCase());
		}

		const explicitAlias = match[5]?.trim();
		if (explicitAlias && !isSqlKeyword(explicitAlias)) {
			reference.qualifiers.add(explicitAlias.toLowerCase());
		}

		references.set(table.name, reference);
	}

	return [...references.values()];
}

function extractReferencedTables(input: string, schema: SqlSchemaSnapshot): SqlTableSummary[] {
	return extractReferencedTableBindings(input, schema).map((reference) => reference.table);
}

function resolveQualifiedColumnContext(input: string, schema: SqlSchemaSnapshot): { prefix: string; tables: SqlTableSummary[] } | null {
	const qualifiedMatch = input.match(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_]*)$/u);
	if (!qualifiedMatch) {
		return null;
	}

	const qualifier = (qualifiedMatch[1] ?? "").toLowerCase();
	const prefix = (qualifiedMatch[2] ?? "").toLowerCase();
	const tables = extractReferencedTableBindings(input, schema)
		.filter((reference) => reference.qualifiers.has(qualifier))
		.map((reference) => reference.table);

	if (tables.length > 0) {
		return { prefix, tables };
	}

	const directTable = findTableByName(schema, qualifier);
	if (!directTable) {
		return null;
	}

	return {
		prefix,
		tables: [directTable],
	};
}

function buildDefaultSnippets(schema: SqlSchemaSnapshot): SqlSuggestion[] {
	const firstTable = findTableByName(schema, "zoomeye") ?? schema.tables[0];
	const snippets: SqlSuggestion[] = [
		{
			label: "SELECT name FROM sqlite_master",
			insertText: "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name;",
			detail: "List real tables and views from StorageKit",
			kind: "snippet",
		},
		{
			label: ".tables",
			insertText: ".tables",
			detail: "Built-in command to list schema tables",
			kind: "snippet",
		},
		{
			label: ".help",
			insertText: ".help",
			detail: "Show console shortcuts and built-ins",
			kind: "snippet",
		},
	];

	const zoomeyeTable = findTableByName(schema, "zoomeye");
	if (zoomeyeTable) {
		snippets.unshift({
			label: "SELECT * FROM zoomeye",
			insertText: `SELECT * FROM ${quoteIdentifier(zoomeyeTable.name)} ORDER BY last_pulled_at DESC LIMIT 20;`,
			detail: `alias -> ${zoomeyeTable.name} • ${zoomeyeTable.rowCount} row(s)`,
			kind: "snippet",
		});
	}

	if (firstTable) {
		const alias = getAliasForTable(firstTable.name, schema);
		snippets.unshift({
			label: `SELECT * FROM ${alias?.alias ?? firstTable.name}`,
			insertText: `SELECT * FROM ${quoteIdentifier(firstTable.name)} LIMIT 20;`,
			detail: `${firstTable.kind}${alias ? ` • alias ${alias.alias}` : ""} • ${firstTable.rowCount} row(s)`,
			kind: "snippet",
		});
	}

	return snippets;
}

function getLastWordPrefix(input: string): string {
	const match = input.match(/([A-Za-z_][A-Za-z0-9_]*)$/u);
	return match?.[1] ?? "";
}

function buildSuggestions(input: string, schema: SqlSchemaSnapshot): SqlSuggestion[] {
	const trimmed = input.trimStart();
	const normalized = input.toUpperCase();
	const suggestions: SqlSuggestion[] = [];
	const seen = new Set<string>();

	const pushSuggestion = (suggestion: SqlSuggestion): void => {
		if (seen.has(suggestion.insertText)) {
			return;
		}

		seen.add(suggestion.insertText);
		suggestions.push(suggestion);
	};

	if (trimmed.length === 0) {
		buildDefaultSnippets(schema).forEach(pushSuggestion);
		return suggestions.slice(0, MAX_SUGGESTIONS);
	}

	const tableContextMatch = input.match(/\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+([A-Za-z0-9_"'`]*)$/iu);
	if (tableContextMatch) {
		const tablePrefix = (tableContextMatch[1] ?? "").replace(/^['"`]/u, "").toLowerCase();
		for (const alias of getAvailableTableAliases(schema)) {
			if (alias.alias.startsWith(tablePrefix)) {
				const table = findTableByName(schema, alias.table);
				if (!table) {
					continue;
				}

				pushSuggestion({
					label: alias.alias,
					insertText: table.name,
					detail: `alias -> ${table.name} • ${table.rowCount} row(s)`,
					kind: "table",
				});
			}
		}
		for (const table of schema.tables) {
			if (table.name.toLowerCase().startsWith(tablePrefix)) {
				const alias = getAliasForTable(table.name, schema);
				pushSuggestion({
					label: alias?.alias ?? table.name,
					insertText: table.name,
					detail: `${table.kind}${alias ? ` • ${table.name}` : ""} • ${table.columns.length} col(s) • ${table.rowCount} row(s)`,
					kind: "table",
				});
			}
		}
		return suggestions.slice(0, MAX_SUGGESTIONS);
	}

	const pragmaContextMatch = input.match(/\bPRAGMA\s+table_info\((['"`]?[A-Za-z0-9_]*)$/iu);
	if (pragmaContextMatch) {
		const tablePrefix = (pragmaContextMatch[1] ?? "").replace(/^['"`]/u, "").toLowerCase();
		for (const table of schema.tables) {
			if (table.name.toLowerCase().startsWith(tablePrefix)) {
				pushSuggestion({
					label: table.name,
					insertText: `${quoteStringLiteral(table.name)})`,
					detail: `Columns for ${table.name}`,
					kind: "table",
				});
			}
		}
		return suggestions.slice(0, MAX_SUGGESTIONS);
	}

	const valueContextMatch = input.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*'?([^']*)$/u);
	if (valueContextMatch) {
		const columnName = valueContextMatch[1] ?? "";
		const valuePrefix = (valueContextMatch[2] ?? "").toLowerCase();
		const referencedTables = extractReferencedTables(input, schema);
		for (const table of referencedTables) {
			const sampleValues = table.sampleValues[columnName] ?? [];
			for (const value of sampleValues) {
				if (value.toLowerCase().startsWith(valuePrefix)) {
					pushSuggestion({
						label: value,
						insertText: `'${value.replace(/'/gu, "''")}'`,
						detail: `${table.name}.${columnName} sample value`,
						kind: "value",
					});
				}
			}
		}
		if (suggestions.length > 0) {
			return suggestions.slice(0, MAX_SUGGESTIONS);
		}
	}

	const qualifiedColumnContext = resolveQualifiedColumnContext(input, schema);
	if (qualifiedColumnContext) {
		for (const table of qualifiedColumnContext.tables) {
			for (const column of table.columns) {
				if (column.name.toLowerCase().startsWith(qualifiedColumnContext.prefix)) {
					pushSuggestion({
						label: column.name,
						insertText: column.name,
						detail: `${table.name} • ${column.type || "untyped"}`,
						kind: "column",
					});
				}
			}
		}
		if (suggestions.length > 0) {
			return suggestions.slice(0, MAX_SUGGESTIONS);
		}
	}

	const columnContext = /\b(?:SELECT|WHERE|AND|OR|ORDER BY|GROUP BY|SET)\s+([A-Za-z0-9_.,\s"`]*)$/iu.test(input);
	if (columnContext) {
		const columnPrefix = getLastWordPrefix(input).toLowerCase();
		const referencedTables = extractReferencedTables(input, schema);
		const tables = referencedTables.length > 0 ? referencedTables : schema.tables;
		for (const table of tables) {
			for (const column of table.columns) {
				if (column.name.toLowerCase().startsWith(columnPrefix)) {
					pushSuggestion({
						label: column.name,
						insertText: column.name,
						detail: `${table.name} • ${column.type || "untyped"}`,
						kind: "column",
					});
				}
			}
		}
		if (suggestions.length > 0) {
			return suggestions.slice(0, MAX_SUGGESTIONS);
		}
	}

	const keywordPrefix = getLastWordPrefix(normalized);
	for (const keyword of SQL_KEYWORDS) {
		if (keyword.startsWith(keywordPrefix)) {
			pushSuggestion({
				label: keyword,
				insertText: keyword,
				detail: "SQL keyword",
				kind: "keyword",
			});
		}
	}

	for (const table of schema.tables) {
		const alias = getAliasForTable(table.name, schema);
		const prefix = getLastWordPrefix(input).toLowerCase();
		if (table.name.toLowerCase().startsWith(prefix) || (alias?.alias.startsWith(prefix) ?? false)) {
			pushSuggestion({
				label: alias?.alias ?? table.name,
				insertText: table.name,
				detail: `${table.kind}${alias ? ` • ${table.name}` : ""} • ${table.rowCount} row(s)`,
				kind: "table",
			});
		}
	}

	return suggestions.slice(0, MAX_SUGGESTIONS);
}

export function getSqlNotebookCompletionItems(input: string, schema: SqlSchemaSnapshot): SqlNotebookCompletionItem[] {
	return buildSuggestions(input, schema).map((suggestion) => ({
		value: suggestion.insertText,
		label: suggestion.label,
		detail: suggestion.detail,
		kind: "command",
	}));
}

function formatSchemaHelp(schema: SqlSchemaSnapshot): string {
	const aliasLines = getAvailableTableAliases(schema)
		.map((alias) => `  ${alias.alias} -> ${alias.table}`)
		.join("\n");
	const preview = schema.tables
		.slice(0, 6)
		.map((table) => {
			const alias = getAliasForTable(table.name, schema);
			return `${alias ? `${alias.alias} -> ` : ""}${table.name}(${table.columns.map((column) => column.name).join(", ")})`;
		})
		.join("\n");

	return [
		"Commands:",
		"  .db              Show the active StorageKit database path",
		"  .help            Show shortcuts and built-ins",
		"  .tables          List live tables from StorageKit",
		"  .schema <table>  Show columns and sample values",
		"  .clear           Clear output history",
		"",
		"Keyboard:",
		"  Enter runs query • Tab accepts suggestion • Up/Down navigate suggestions/history",
		"  Ctrl+L clears output • Ctrl+R refreshes schema • Esc exits",
		"",
		aliasLines.length > 0 ? `Logical sources:\n${aliasLines}` : null,
		aliasLines.length > 0 ? "" : null,
		preview.length > 0 ? `Live schema preview:\n${preview}` : "No tables found in StorageKit yet.",
	].filter((line): line is string => line !== null).join("\n");
}

export function formatTableList(schema: SqlSchemaSnapshot): string {
	if (schema.tables.length === 0) {
		return "No tables or views found in StorageKit.";
	}

	return schema.tables
		.map((table) => {
			const alias = getAliasForTable(table.name, schema);
			return `${(alias?.alias ?? table.name).padEnd(14, " ")} -> ${table.name.padEnd(24, " ")} ${table.kind.padEnd(5, " ")} ${String(table.rowCount).padStart(6, " ")} rows`;
		})
		.join("\n");
}

export function formatTableSchema(table: SqlTableSummary): string {
	const alias = SQL_TABLE_ALIASES.find((candidate) => candidate.table === table.name);
	const lines = [
		`${alias ? `${alias.alias} -> ` : ""}${table.name} (${table.kind}) • ${table.rowCount} row(s)`,
		...table.columns.map((column) => {
			const samples = table.sampleValues[column.name] ?? [];
			const suffix = samples.length > 0 ? ` • samples: ${samples.join(", ")}` : "";
			return `- ${column.name} ${column.type || ""}${column.notNull ? " NOT NULL" : ""}${column.primaryKey ? " PRIMARY KEY" : ""}${suffix}`.trimEnd();
		}),
	];

	return lines.join("\n");
}

export async function readSchemaSnapshot(storageKit: StorageKit): Promise<SqlSchemaSnapshot> {
	const client = getStorageClient(storageKit);
	const rawTables = client.query(
		`SELECT name, type
		FROM sqlite_master
		WHERE type IN ('table', 'view')
			AND name NOT LIKE 'sqlite_%'
		ORDER BY name`,
	).all() as Array<{ name?: string; type?: string }>;

	const tables: SqlTableSummary[] = [];

	for (const rawTable of rawTables) {
		if (!rawTable.name) {
			continue;
		}

		const name = rawTable.name;
		const kind = rawTable.type === "view" ? "view" : "table";
		const columnRows = client.query(`PRAGMA table_info(${quoteStringLiteral(name)})`).all() as Array<{
			name?: string;
			type?: string;
			notnull?: number;
			pk?: number;
		}>;
		const columns = columnRows
			.filter((column) => typeof column.name === "string")
			.map((column) => ({
				name: column.name ?? "",
				type: column.type ?? "",
				notNull: column.notnull === 1,
				primaryKey: (column.pk ?? 0) > 0,
			}));
		const countRow = client.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get() as { count?: number } | null;
		const sampleValues: Record<string, string[]> = {};

		for (const column of columns.slice(0, 8)) {
			try {
				const rawSamples = client.query(
					`SELECT DISTINCT ${quoteIdentifier(column.name)} AS value
					FROM ${quoteIdentifier(name)}
					WHERE ${quoteIdentifier(column.name)} IS NOT NULL
					LIMIT ${MAX_SAMPLE_VALUES}`,
				).all() as Array<{ value?: unknown }>;
				const samples = rawSamples
					.map((row) => normalizeScalarValue(row.value))
					.filter((value) => value !== "NULL")
					.slice(0, MAX_SAMPLE_VALUES);

				if (samples.length > 0) {
					sampleValues[column.name] = samples;
				}
			} catch {
				// Ignore per-column sample failures and keep the rest of the schema usable.
			}
		}

		tables.push({
			name,
			kind,
			rowCount: countRow?.count ?? 0,
			columns,
			sampleValues,
		});
	}

	return {
		tables,
		refreshedAt: new Date().toISOString(),
	};
}

export async function executeSql(storageKit: StorageKit, query: string): Promise<SqlExecutionResult> {
	const client = getStorageClient(storageKit);
	const startedAt = performance.now();

	if (isReadQuery(query)) {
		const rows = client.query(query).all() as Record<string, unknown>[];
		return {
			kind: "rows",
			columns: extractRowColumns(rows),
			rows: rows.slice(0, MAX_RESULT_ROWS),
			truncated: rows.length > MAX_RESULT_ROWS,
			elapsedMs: performance.now() - startedAt,
		};
	}

	const result = client.query(query).run();
	const rawLastInsertRowid = result.lastInsertRowid;
	return {
		kind: "write",
		changes: result.changes,
		lastInsertRowid: rawLastInsertRowid === undefined
			? null
			: typeof rawLastInsertRowid === "bigint"
				? Number(rawLastInsertRowid)
				: rawLastInsertRowid,
		elapsedMs: performance.now() - startedAt,
	};
}

function readDirectSqlQuery(params: SqlModuleParams): string | null {
	if (params.query === undefined) {
		return null;
	}

	if (typeof params.query !== "string") {
		throw new InvalidParamsError("Param 'query' must be a string.");
	}

	const trimmedQuery = params.query.trim();
	if (trimmedQuery.length === 0) {
		throw new InvalidParamsError("Param 'query' must be a non-empty string.");
	}

	return trimmedQuery;
}

export function toSqlModuleQueryResult(result: SqlExecutionResult): SqlModuleQueryResult {
	if (result.kind === "rows") {
		return {
			rows: result.rows,
			columns: result.columns,
			meta: {
				kind: result.kind,
				elapsedMs: result.elapsedMs,
				truncated: result.truncated,
			},
		};
	}

	if (result.kind === "write") {
		return {
			rows: [],
			columns: [],
			meta: {
				kind: result.kind,
				elapsedMs: result.elapsedMs,
				changes: result.changes,
				lastInsertRowid: result.lastInsertRowid,
			},
		};
	}

	return {
		rows: [],
		columns: [],
		meta: {
			kind: result.kind,
			elapsedMs: result.elapsedMs,
			text: result.text,
		},
	};
}

function SqlConsoleApplication({
	databasePath,
	width,
	height,
	onExit,
	promptLabel,
	initialSchema,
	executeQuery,
	refreshSchema,
}: SqlConsoleAppProps) {
	const [schema, setSchema] = useState(initialSchema);
	const [entries, setEntries] = useState<SqlConsoleEntry[]>([]);
	const [inputValue, setInputValue] = useState("");
	const [cursorOffset, setCursorOffset] = useState(0);
	const [busy, setBusy] = useState(false);
	const [statusText, setStatusText] = useState("StorageKit/sqlite backend • Tab accepts suggestion • Ctrl+R refreshes schema");
	const [queryHistory, setQueryHistory] = useState<string[]>([]);
	const [historyIndex, setHistoryIndex] = useState<number | null>(null);
	const [historyDraft, setHistoryDraft] = useState("");
	const [suggestionIndex, setSuggestionIndex] = useState(0);

	const promptText = `${promptLabel}/> `;
	const deferredSuggestionInput = useDeferredValue(inputValue.slice(0, cursorOffset));
	const suggestions = useMemo(
		() => buildSuggestions(deferredSuggestionInput, schema),
		[deferredSuggestionInput, schema],
	);
	const activeSuggestion = suggestions.length > 0
		? suggestions[Math.max(0, Math.min(suggestionIndex, suggestions.length - 1))]
		: null;
	const transcriptLines = useMemo(() => flattenEntries(entries, width), [entries, width]);
	const inputViewport = createInputViewport(inputValue, cursorOffset, Math.max(12, width - promptText.length - 4));
	const reservedRows = 7 + suggestions.length;
	const bodyRows = Math.max(4, height - reservedRows);
	const visibleTranscript = transcriptLines.slice(-bodyRows);

	const replaceInput = (
		nextValue: string,
		nextCursorOffset: number = nextValue.length,
		options: { resetHistoryNavigation?: boolean } = {},
	): void => {
		setInputValue(nextValue);
		setCursorOffset(Math.max(0, Math.min(nextCursorOffset, nextValue.length)));
		if (options.resetHistoryNavigation ?? true) {
			setHistoryIndex(null);
		}
		setSuggestionIndex(0);
	};

	const appendEntries = (...nextEntries: SqlConsoleEntry[]): void => {
		setEntries((current) => [...current, ...nextEntries].slice(-MAX_TRANSCRIPT_ITEMS));
	};

	const acceptSuggestion = (): boolean => {
		if (!activeSuggestion) {
			return false;
		}

		const prefix = inputValue.slice(0, cursorOffset);
		const suffix = inputValue.slice(cursorOffset);
		const wordPrefix = getLastWordPrefix(prefix);
		const insertStart = wordPrefix.length > 0 ? cursorOffset - wordPrefix.length : cursorOffset;
		const nextValue = `${inputValue.slice(0, insertStart)}${activeSuggestion.insertText}${suffix}`;
		replaceInput(nextValue, insertStart + activeSuggestion.insertText.length);
		return true;
	};

	const refreshSchemaState = async (): Promise<void> => {
		setBusy(true);
		setStatusText("Refreshing live StorageKit schema...");
		try {
			const nextSchema = await refreshSchema();
			setSchema(nextSchema);
			setStatusText(`Schema refreshed • ${nextSchema.tables.length} table(s)/view(s)`);
		} catch (error) {
			setStatusText(`Schema refresh failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			setBusy(false);
		}
	};

	const runInput = async (): Promise<void> => {
		const query = inputValue.trim();
		if (query.length === 0 || busy) {
			return;
		}

		if (query === ".db") {
			const aliasLines = getAvailableTableAliases(schema)
				.map((alias) => `${alias.alias} -> ${alias.table}`)
				.join("\n");
			appendEntries({
				kind: "info",
				text: [
					`StorageKit DB: ${databasePath}`,
					aliasLines.length > 0 ? `Logical sources:\n${aliasLines}` : null,
				].filter((line): line is string => line !== null).join("\n\n"),
			});
			replaceInput("");
			setStatusText("Database info loaded");
			return;
		}

		if (query === ".clear") {
			setEntries([]);
			replaceInput("");
			setStatusText("Output cleared");
			return;
		}

		if (query === ".help") {
			appendEntries({ kind: "info", text: formatSchemaHelp(schema) });
			replaceInput("");
			setStatusText("Help loaded");
			return;
		}

		if (query === ".tables") {
			appendEntries({ kind: "info", text: formatTableList(schema) });
			replaceInput("");
			setStatusText(`Listed ${schema.tables.length} table(s)/view(s)`);
			return;
		}

		if (query.startsWith(".schema ")) {
			const tableName = query.slice(".schema ".length).trim();
			const table = findTableByName(schema, tableName);
			appendEntries({
				kind: table ? "info" : "error",
				text: table ? formatTableSchema(table) : `Unknown table or view: ${tableName}`,
			});
			replaceInput("");
			setStatusText(table ? `Schema loaded for ${table.name}` : "Schema lookup failed");
			return;
		}

		appendEntries({ kind: "command", text: `${promptText}${query}` });
		setBusy(true);
		setStatusText("Running query...");
		setQueryHistory((current) => [...current, query].slice(-100));
		setHistoryIndex(null);
		setHistoryDraft("");
		const effectiveQuery = rewriteQueryTableAliases(query, schema);

		try {
			const result = await executeQuery(effectiveQuery);
			if (result.kind === "rows") {
				appendEntries({
					kind: "output",
					text: [
						`${result.rows.length}${result.truncated ? "+" : ""} row(s) • ${result.elapsedMs.toFixed(1)} ms`,
						formatRows(result.rows, width),
					].join("\n"),
				});
				setStatusText(`Read query complete • ${result.rows.length}${result.truncated ? "+" : ""} row(s)`);
			} else if (result.kind === "write") {
				appendEntries({
					kind: "output",
					text: `OK • changes=${result.changes}${result.lastInsertRowid !== null ? ` • lastInsertRowid=${result.lastInsertRowid}` : ""} • ${result.elapsedMs.toFixed(1)} ms`,
				});
				setStatusText(`Write query complete • ${result.changes} change(s)`);
			} else {
				appendEntries({ kind: "info", text: `${result.text} • ${result.elapsedMs.toFixed(1)} ms` });
				setStatusText("Command complete");
			}

			const nextSchema = await refreshSchema();
			setSchema(nextSchema);
		} catch (error) {
			appendEntries({
				kind: "error",
				text: error instanceof Error ? error.message : String(error),
			});
			setStatusText("Query failed");
		} finally {
			setBusy(false);
			replaceInput("");
		}
	};

	useInput((input, key) => {
		if (key.escape || (key.ctrl && input === "c")) {
			onExit(0);
			return;
		}

		if (busy) {
			return;
		}

		if (key.ctrl && input.toLowerCase() === "l") {
			setEntries([]);
			setStatusText("Output cleared");
			return;
		}

		if (key.ctrl && input.toLowerCase() === "r") {
			void refreshSchemaState();
			return;
		}

		if (key.tab || input === "\t") {
			if (acceptSuggestion()) {
				return;
			}
		}

		if (key.upArrow) {
			if (suggestions.length > 0) {
				setSuggestionIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
				return;
			}

			setHistoryIndex((current) => {
				const nextIndex = current === null
					? queryHistory.length - 1
					: Math.max(0, current - 1);
				if (queryHistory.length === 0 || nextIndex < 0) {
					return current;
				}

				if (current === null) {
					setHistoryDraft(inputValue);
				}
				replaceInput(queryHistory[nextIndex] ?? "", undefined, { resetHistoryNavigation: false });
				return nextIndex;
			});
			return;
		}

		if (key.downArrow) {
			if (suggestions.length > 0) {
				setSuggestionIndex((current) => (current + 1) % suggestions.length);
				return;
			}

			setHistoryIndex((current) => {
				if (current === null) {
					return null;
				}

				const nextIndex = current + 1;
				if (nextIndex >= queryHistory.length) {
					replaceInput(historyDraft, undefined, { resetHistoryNavigation: false });
					return null;
				}

				replaceInput(queryHistory[nextIndex] ?? "", undefined, { resetHistoryNavigation: false });
				return nextIndex;
			});
			return;
		}

		if (key.leftArrow) {
			setCursorOffset((current) => Math.max(0, current - 1));
			setSuggestionIndex(0);
			return;
		}

		if (key.rightArrow) {
			setCursorOffset((current) => Math.min(inputValue.length, current + 1));
			setSuggestionIndex(0);
			return;
		}

		if (key.backspace) {
			if (cursorOffset === 0) {
				return;
			}

			const nextValue = `${inputValue.slice(0, cursorOffset - 1)}${inputValue.slice(cursorOffset)}`;
			replaceInput(nextValue, cursorOffset - 1);
			return;
		}

		if (key.delete) {
			if (cursorOffset >= inputValue.length) {
				return;
			}

			const nextValue = `${inputValue.slice(0, cursorOffset)}${inputValue.slice(cursorOffset + 1)}`;
			replaceInput(nextValue, cursorOffset);
			return;
		}

		if (key.return) {
			void runInput();
			return;
		}

		if (input.length === 1 && !key.ctrl && !key.meta) {
			const nextValue = `${inputValue.slice(0, cursorOffset)}${input}${inputValue.slice(cursorOffset)}`;
			replaceInput(nextValue, cursorOffset + 1);
		}
	});

	return (
		<Box flexDirection="column" width={width} height={height} paddingX={1}>
			<Text color="#7dd3fc" bold>{promptLabel} console</Text>
			<Text color="#9ca3af">StorageKit/sqlite backend • db: {databasePath} • live schema: {schema.tables.length} table(s)/view(s)</Text>

			<Box flexDirection="column" flexGrow={1} marginTop={1}>
				{visibleTranscript.length === 0 ? (
					<Text color="#6b7280">Type SQL or use .help. ZoomEye is available as `zoomeye` -&gt; `zoomeye_hosts` inside the same StorageKit DB.</Text>
				) : (
					visibleTranscript.map((line, index) => (
						<Text key={`${index}:${line.text}`} color={line.color}>{line.text}</Text>
					))
				)}
			</Box>

			<Box flexDirection="column" marginTop={1}>
				<Text color="#34d399">{promptText}<Text color="#f5f5f5">{inputViewport.left}</Text><Text inverse>{inputViewport.cursor}</Text><Text color="#f5f5f5">{inputViewport.right}</Text></Text>
				{suggestions.length > 0 ? (
					<Box flexDirection="column" marginTop={1}>
						{suggestions.map((suggestion, index) => (
							<Text key={`${suggestion.insertText}:${index}`} color={index === suggestionIndex ? "#fbbf24" : "#9ca3af"}>
								{index === suggestionIndex ? "> " : "  "}
								{suggestion.label}
								<Text color="#6b7280"> {suggestion.detail}</Text>
							</Text>
						))}
					</Box>
				) : null}
				<Text color={busy ? "#fbbf24" : "#6b7280"}>{statusText}</Text>
			</Box>
		</Box>
	);
}

export const sqlExecutor = defineExecutor(async (context: SqlModuleContext) => {
	const storageKit = await ensureStorageKit(context);
	const directQuery = readDirectSqlQuery(context.params);
	if (directQuery !== null) {
		return toSqlModuleQueryResult(await executeSql(storageKit, directQuery));
	}

	const initialSchema = await readSchemaSnapshot(storageKit);
	const exitCode = await context.runInteractiveApplication(SqlConsoleApplication, {
		databasePath: storageKit.getDatabasePath(),
		promptLabel: context.module.id,
		initialSchema,
		executeQuery: async (query: string) => await executeSql(storageKit, query),
		refreshSchema: async () => await readSchemaSnapshot(storageKit),
	});

	return { exitCode };
});