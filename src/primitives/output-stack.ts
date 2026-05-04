import {
	createTableEntity,
	createTextEntity,
	type OutputEntity,
	type OutputTone,
	type PrimitiveTableColumn,
	type PrimitiveTableRow,
} from "./entity";
import { createTreeEntity, type PrimitiveTreeEntity, type PrimitiveTreeNode } from "./tree";

export type OutputStackListener = (items: readonly OutputEntity[]) => void;

function inferColumns(rows: PrimitiveTableRow[]): PrimitiveTableColumn[] {
	const keys = new Set<string>();
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			keys.add(key);
		}
	}

	return [...keys].map(key => ({
		key,
		header: key,
		align: typeof rows.find(row => typeof row[key] === "number")?.[key] === "number" ? "right" : "left",
	}));
}

export class OutputStack {
	private readonly listeners = new Set<OutputStackListener>();
	private readonly limit: number;
	private items: OutputEntity[] = [];

	constructor(limit = 240) {
		this.limit = limit;
	}

	snapshot(): readonly OutputEntity[] {
		return this.items;
	}

	peek(): OutputEntity | null {
		return this.items.at(-1) ?? null;
	}

	push(entity: OutputEntity | readonly OutputEntity[]): void {
		const nextItems = Array.isArray(entity) ? [...entity] : [entity];
		if (nextItems.length === 0) {
			return;
		}

		this.items = [...this.items, ...nextItems].slice(-this.limit);
		this.notify();
	}

	appendText(text: string | string[], options: { tone?: OutputTone; title?: string } = {}): void {
		this.push(createTextEntity(text, options));
	}

	pushTable(
		rows: PrimitiveTableRow[],
		options: {
			columns?: PrimitiveTableColumn[];
			title?: string;
		} = {},
	): void {
		this.push(createTableEntity(options.columns ?? inferColumns(rows), rows, { title: options.title }));
	}

	pushTree(roots: PrimitiveTreeNode[], options: { title?: string } = {}): void {
		this.push(createTreeEntity(roots, { title: options.title }));
	}

	pop(): OutputEntity | null {
		const item = this.items.pop() ?? null;
		if (item) {
			this.notify();
		}

		return item;
	}

	replace(items: readonly OutputEntity[]): void {
		this.items = [...items].slice(-this.limit);
		this.notify();
	}

	clear(): void {
		if (this.items.length === 0) {
			return;
		}

		this.items = [];
		this.notify();
	}

	subscribe(listener: OutputStackListener): () => void {
		this.listeners.add(listener);
		listener(this.items);

		return () => {
			this.listeners.delete(listener);
		};
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener(this.items);
		}
	}
}

export const outputStack = new OutputStack();

export type { OutputEntity, PrimitiveTreeEntity };