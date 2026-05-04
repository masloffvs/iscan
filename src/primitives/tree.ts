import type { OutputEntityBase, OutputTone } from "./entity";

export type PrimitiveTreeNode = {
	id?: string;
	label: string;
	value?: string | number | boolean | null;
	children?: PrimitiveTreeNode[];
	tone?: OutputTone;
	meta?: Record<string, unknown>;
};

export type PrimitiveTreePresentation = {
	kind: "ink-tree";
	dense?: boolean;
	showValues?: boolean;
};

export type PrimitiveTreeEntity = OutputEntityBase & {
	kind: "tree";
	roots: PrimitiveTreeNode[];
	presentation: PrimitiveTreePresentation;
};

function createTreeId(prefix: string): string {
	return `${prefix}:${Date.now()}:${crypto.randomUUID()}`;
}

export function createTreeNode(
	label: string,
	options: Omit<PrimitiveTreeNode, "label"> = {},
): PrimitiveTreeNode {
	return {
		id: options.id ?? createTreeId("tree-node"),
		label,
		value: options.value,
		children: options.children ?? [],
		tone: options.tone,
		meta: options.meta,
	};
}

export function createTreeEntity(
	roots: PrimitiveTreeNode[],
	options: Partial<Omit<PrimitiveTreeEntity, "kind" | "roots" | "presentation">> & {
		presentation?: Partial<PrimitiveTreePresentation>;
	} = {},
): PrimitiveTreeEntity {
	return {
		id: options.id ?? createTreeId("tree"),
		createdAt: options.createdAt ?? Date.now(),
		title: options.title,
		meta: options.meta,
		kind: "tree",
		roots,
		presentation: {
			kind: "ink-tree",
			dense: options.presentation?.dense ?? true,
			showValues: options.presentation?.showValues ?? true,
		},
	};
}

export function isPrimitiveTreeNode(value: unknown): value is PrimitiveTreeNode {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as PrimitiveTreeNode;
	return typeof candidate.label === "string";
}

export function isPrimitiveTreeEntity(value: unknown): value is PrimitiveTreeEntity {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as PrimitiveTreeEntity;
	return candidate.kind === "tree" && Array.isArray(candidate.roots);
}
