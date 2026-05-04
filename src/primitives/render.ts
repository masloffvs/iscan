import type { OutputEntity, OutputTone, PrimitiveTableColumn, PrimitiveTableRow, PrimitiveTextEntity } from "./entity";
import type { PrimitiveTreeEntity, PrimitiveTreeNode } from "./tree";

export type RenderedOutputLine = {
	id: string;
	text: string;
	tone: OutputTone;
};

function pushLine(lines: RenderedOutputLine[], id: string, text: string, tone: OutputTone): void {
	const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const segments = normalizedText.split("\n");

	if (segments.length <= 1) {
		lines.push({ id, text: normalizedText, tone });
		return;
	}

	for (let index = 0; index < segments.length; index += 1) {
		lines.push({
			id: `${id}:${index}`,
			text: segments[index] ?? "",
			tone,
		});
	}
}

function stringifyValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}

	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}

	return JSON.stringify(value);
}

function sanitizeTableCellText(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\s*\n+\s*/g, " ")
		.replace(/ {2,}/g, " ")
		.trim();
}

function sanitizeInlineText(text: string): string {
	return sanitizeTableCellText(text);
}

function truncateCell(text: string, width: number): string {
	if (text.length <= width) {
		return text;
	}

	if (width <= 1) {
		return text.slice(0, width);
	}

	return `${text.slice(0, width - 1)}…`;
}

function padCell(text: string, width: number, align: PrimitiveTableColumn["align"]): string {
	const value = truncateCell(text, width);
	if (align === "right") {
		return value.padStart(width, " ");
	}

	if (align === "center") {
		const total = Math.max(0, width - value.length);
		const left = Math.floor(total / 2);
		const right = total - left;
		return `${" ".repeat(left)}${value}${" ".repeat(right)}`;
	}

	return value.padEnd(width, " ");
}

function computeColumnWidths(columns: PrimitiveTableColumn[], rows: PrimitiveTableRow[], width: number): number[] {
	const separatorWidth = Math.max(0, (columns.length - 1) * 3);
	const availableWidth = Math.max(columns.length * 4, width - separatorWidth);
	const result = columns.map(column => {
		const headerWidth = column.header.length;
		const valueWidth = Math.max(
			0,
			...rows.map(row => sanitizeTableCellText(stringifyValue(row[column.key])).length),
		);
		return Math.min(column.maxWidth ?? 40, Math.max(4, column.width ?? 0, headerWidth, valueWidth));
	});

	let totalWidth = result.reduce((sum, cellWidth) => sum + cellWidth, 0);
	while (totalWidth > availableWidth) {
		let changed = false;
		for (let index = 0; index < result.length && totalWidth > availableWidth; index += 1) {
			if (result[index] > 4) {
				result[index] -= 1;
				totalWidth -= 1;
				changed = true;
			}
		}

		if (!changed) {
			break;
		}
	}

	return result;
}

function renderTextEntity(entity: PrimitiveTextEntity): RenderedOutputLine[] {
	const lines: RenderedOutputLine[] = [];
	if (entity.title) {
		pushLine(lines, `${entity.id}:title`, entity.title, "info");
	}

	for (let index = 0; index < entity.lines.length; index += 1) {
		pushLine(lines, `${entity.id}:${index}`, entity.lines[index] ?? "", entity.tone);
	}

	return lines;
}

function renderTableEntity(entity: Extract<OutputEntity, { kind: "table" }>, width: number): RenderedOutputLine[] {
	const lines: RenderedOutputLine[] = [];
	const columnWidths = computeColumnWidths(entity.columns, entity.rows, width);

	if (entity.title) {
		pushLine(lines, `${entity.id}:title`, entity.title, "info");
	}

	const header = entity.columns
		.map((column, index) => padCell(column.header, columnWidths[index] ?? 4, column.align))
		.join(" | ");
	pushLine(lines, `${entity.id}:header`, header, "accent");

	const divider = columnWidths.map(cellWidth => "-".repeat(cellWidth)).join("-+-");
	pushLine(lines, `${entity.id}:divider`, divider, "muted");

	for (let rowIndex = 0; rowIndex < entity.rows.length; rowIndex += 1) {
		const row = entity.rows[rowIndex] ?? {};
		const rowText = entity.columns
			.map((column, columnIndex) => padCell(
				sanitizeTableCellText(stringifyValue(row[column.key])),
				columnWidths[columnIndex] ?? 4,
				column.align,
			))
			.join(" | ");
		pushLine(lines, `${entity.id}:row:${rowIndex}`, rowText, "output");
	}

	return lines;
}

function renderTreeNode(
	lines: RenderedOutputLine[],
	entityId: string,
	node: PrimitiveTreeNode,
	prefix: string,
	depth: number,
	isLast: boolean,
	indexPath: string,
	showValues: boolean,
): void {
	const branch = depth === 0 ? "" : isLast ? "└─ " : "├─ ";
	const label = sanitizeInlineText(node.label);
	const valueSuffix = showValues && node.value !== undefined && node.value !== null
		? `: ${sanitizeInlineText(stringifyValue(node.value))}`
		: "";
	pushLine(lines, `${entityId}:${indexPath}`, `${prefix}${branch}${label}${valueSuffix}`, node.tone ?? "output");

	const children = node.children ?? [];
	for (let index = 0; index < children.length; index += 1) {
		const child = children[index];
		if (!child) {
			continue;
		}

		const nextPrefix = depth === 0 ? "" : `${prefix}${isLast ? "   " : "│  "}`;
		renderTreeNode(lines, entityId, child, nextPrefix, depth + 1, index === children.length - 1, `${indexPath}.${index}`, showValues);
	}
}

function renderTreeEntity(entity: PrimitiveTreeEntity): RenderedOutputLine[] {
	const lines: RenderedOutputLine[] = [];
	if (entity.title) {
		pushLine(lines, `${entity.id}:title`, entity.title, "info");
	}

	for (let index = 0; index < entity.roots.length; index += 1) {
		const root = entity.roots[index];
		if (!root) {
			continue;
		}

		renderTreeNode(lines, entity.id, root, "", 0, index === entity.roots.length - 1, String(index), entity.presentation.showValues);
	}

	return lines;
}

export function renderOutputEntities(items: readonly OutputEntity[], width: number): RenderedOutputLine[] {
	const lines: RenderedOutputLine[] = [];
	for (const item of items) {
		switch (item.kind) {
			case "text":
				lines.push(...renderTextEntity(item));
				break;
			case "table":
				lines.push(...renderTableEntity(item, width));
				break;
			case "tree":
				lines.push(...renderTreeEntity(item));
				break;
		}
	}

	return lines;
}