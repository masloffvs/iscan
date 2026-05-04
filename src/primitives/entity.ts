import type { PrimitiveTreeEntity } from "./tree";

export type OutputTone = "command" | "output" | "info" | "error" | "muted" | "accent";

export type OutputEntityBase = {
	id: string;
	createdAt: number;
	title?: string;
	meta?: Record<string, unknown>;
};

export type PrimitiveTextEntity = OutputEntityBase & {
	kind: "text";
	lines: string[];
	tone: OutputTone;
	presentation: {
		kind: "plain-text";
	};
};

export type PrimitiveCellValue = string | number | boolean | null | undefined;

export type PrimitiveTableColumn = {
	key: string;
	header: string;
	align?: "left" | "right" | "center";
	width?: number;
	maxWidth?: number;
};

export type PrimitiveTableRow = Record<string, PrimitiveCellValue>;

export type PrimitiveTableEntity = OutputEntityBase & {
	kind: "table";
	columns: PrimitiveTableColumn[];
	rows: PrimitiveTableRow[];
	presentation: {
		kind: "ink-table";
		dense?: boolean;
	};
};

export type OutputEntity = PrimitiveTextEntity | PrimitiveTableEntity | PrimitiveTreeEntity;

function createEntityId(prefix: string): string {
	return `${prefix}:${Date.now()}:${crypto.randomUUID()}`;
}

export function createTextEntity(
	text: string | string[],
	options: Partial<Omit<PrimitiveTextEntity, "kind" | "lines" | "presentation">> = {},
): PrimitiveTextEntity {
	return {
		id: options.id ?? createEntityId("text"),
		createdAt: options.createdAt ?? Date.now(),
		title: options.title,
		meta: options.meta,
		kind: "text",
		lines: Array.isArray(text) ? [...text] : text.split(/\r?\n/u),
		tone: options.tone ?? "output",
		presentation: {
			kind: "plain-text",
		},
	};
}

export function createTableEntity(
	columns: PrimitiveTableColumn[],
	rows: PrimitiveTableRow[],
	options: Partial<Omit<PrimitiveTableEntity, "kind" | "columns" | "rows" | "presentation">> = {},
): PrimitiveTableEntity {
	return {
		id: options.id ?? createEntityId("table"),
		createdAt: options.createdAt ?? Date.now(),
		title: options.title,
		meta: options.meta,
		kind: "table",
		columns,
		rows,
		presentation: {
			kind: "ink-table",
			dense: true,
		},
	};
}

export function isOutputEntity(value: unknown): value is OutputEntity {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as OutputEntity;
	return typeof candidate.id === "string"
		&& typeof candidate.createdAt === "number"
		&& typeof candidate.kind === "string";
}

export function normalizeOutputEntities(value: unknown): OutputEntity[] | null {
	if (isOutputEntity(value)) {
		return [value];
	}

	if (Array.isArray(value) && value.every(isOutputEntity)) {
		return [...value];
	}

	return null;
}
