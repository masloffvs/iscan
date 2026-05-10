import { z } from "zod";

export type SettingsGroupDefinition = {
	id: string;
	label: string;
	description?: string;
	order?: number;
};

export type SettingsEditorKind = "string" | "number" | "boolean" | "enum" | "string[]" | "json";

export type SettingsEditorDefinition = {
	kind: SettingsEditorKind;
	enumValues?: string[];
	placeholder?: string;
	multiline?: boolean;
};

export type DynamicSettingDefaultValue<TValue> = TValue | (() => TValue | Promise<TValue>);

export type DynamicSettingDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
	id: string;
	label?: string;
	description?: string;
	type: TSchema;
	default?: DynamicSettingDefaultValue<z.output<TSchema>>;
	validator?: (value: z.output<TSchema>) => void | Promise<void>;
	group?: SettingsGroupDefinition;
	secret?: boolean;
	order?: number;
	editor?: Partial<SettingsEditorDefinition>;
};

export type DynamicSettingAnyDefinition = DynamicSettingDefinition<z.ZodTypeAny>;

export type SerializedSettingsGroup = {
	id: string;
	label: string;
	description?: string;
	order: number;
	settingCount: number;
};

export type SerializedSettingDefinition = {
	id: string;
	label: string;
	description?: string;
	groupId: string | null;
	groupLabel: string | null;
	secret: boolean;
	order: number;
	hasDefault: boolean;
	editor: SettingsEditorDefinition;
	defaultSummary?: string;
};

export type SettingsValueSource = "stored" | "default" | "invalid-stored-default";

export type ResolvedSettingValue<TValue = unknown> = {
	id: string;
	value: TValue;
	source: SettingsValueSource;
	updatedAt?: string;
	validationError?: string;
};

export type SerializedResolvedSettingValue = {
	id: string;
	value: unknown;
	source: SettingsValueSource;
	updatedAt?: string;
	validationError?: string;
};

export type SerializedSettingSnapshot = {
	definition: SerializedSettingDefinition;
	value?: SerializedResolvedSettingValue;
	missing: boolean;
};

export type SettingsCatalogSnapshot = {
	groups: SerializedSettingsGroup[];
	settings: SerializedSettingSnapshot[];
};

function humanizeToken(value: string): string {
	return value
		.replace(/[._-]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim()
		.replace(/\b\w/gu, (match) => match.toUpperCase());
}

export function normalizeSettingsGroupDefinition(group: SettingsGroupDefinition): SettingsGroupDefinition {
	const id = group.id.trim();
	const label = group.label.trim();
	if (id.length === 0) {
		throw new Error("Settings group id must be a non-empty string.");
	}
	if (label.length === 0) {
		throw new Error(`Settings group '${id}' must have a non-empty label.`);
	}

	return {
		id,
		label,
		...(group.description?.trim() ? { description: group.description.trim() } : {}),
		order: typeof group.order === "number" && Number.isFinite(group.order) ? group.order : 0,
	};
}

export function normalizeDynamicSettingDefinition<TSchema extends z.ZodTypeAny>(
	definition: DynamicSettingDefinition<TSchema>,
): DynamicSettingDefinition<TSchema> {
	const id = definition.id.trim();
	if (id.length === 0) {
		throw new Error("Dynamic setting id must be a non-empty string.");
	}

	return {
		...definition,
		id,
		label: definition.label?.trim() || humanizeToken(id),
		description: definition.description?.trim() || undefined,
		group: definition.group ? normalizeSettingsGroupDefinition(definition.group) : undefined,
		secret: definition.secret === true,
		order: typeof definition.order === "number" && Number.isFinite(definition.order) ? definition.order : 0,
	};
}

function unwrapZodSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
	if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
		return unwrapZodSchema(schema.unwrap());
	}

	if (schema instanceof z.ZodEffects) {
		return unwrapZodSchema(schema.innerType());
	}

	return schema;
}

function summarizeDefaultValue(value: unknown): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value === "string") {
		return value.length === 0 ? "empty string" : value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value === null) {
		return "null";
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function resolveSettingsEditorDefinition(definition: DynamicSettingAnyDefinition): SettingsEditorDefinition {
	const unwrapped = unwrapZodSchema(definition.type);
	const baseEditor = definition.editor ?? {};

	if (baseEditor.kind) {
		return {
			kind: baseEditor.kind,
			...(baseEditor.enumValues ? { enumValues: [...baseEditor.enumValues] } : {}),
			...(baseEditor.placeholder ? { placeholder: baseEditor.placeholder } : {}),
			...(baseEditor.multiline !== undefined ? { multiline: baseEditor.multiline } : {}),
		};
	}

	if (unwrapped instanceof z.ZodString) {
		return {
			kind: "string",
			...(baseEditor.placeholder ? { placeholder: baseEditor.placeholder } : {}),
			...(baseEditor.multiline !== undefined ? { multiline: baseEditor.multiline } : {}),
		};
	}

	if (unwrapped instanceof z.ZodNumber) {
		return { kind: "number", ...(baseEditor.placeholder ? { placeholder: baseEditor.placeholder } : {}) };
	}

	if (unwrapped instanceof z.ZodBoolean) {
		return { kind: "boolean" };
	}

	if (unwrapped instanceof z.ZodEnum) {
		return { kind: "enum", enumValues: [...unwrapped.options] };
	}

	if (unwrapped instanceof z.ZodNativeEnum) {
		return {
			kind: "enum",
			enumValues: [...new Set(Object.values(unwrapped.enum).filter((value): value is string => typeof value === "string"))],
		};
	}

	if (unwrapped instanceof z.ZodArray && unwrapZodSchema(unwrapped.element) instanceof z.ZodString) {
		return { kind: "string[]", ...(baseEditor.placeholder ? { placeholder: baseEditor.placeholder } : {}) };
	}

	return { kind: "json", ...(baseEditor.multiline !== undefined ? { multiline: baseEditor.multiline } : { multiline: true }) };
}

export async function serializeDynamicSettingDefinition(
	definition: DynamicSettingAnyDefinition,
): Promise<SerializedSettingDefinition> {
	const normalized = normalizeDynamicSettingDefinition(definition);
	let defaultSummary: string | undefined;
	if (normalized.default !== undefined && !normalized.secret) {
		const defaultValue = typeof normalized.default === "function"
			? await (normalized.default as () => unknown | Promise<unknown>)()
			: normalized.default;
		defaultSummary = summarizeDefaultValue(defaultValue);
	}

	return {
		id: normalized.id,
		label: normalized.label ?? normalized.id,
		...(normalized.description ? { description: normalized.description } : {}),
		groupId: normalized.group?.id ?? null,
		groupLabel: normalized.group?.label ?? null,
		secret: normalized.secret === true,
		order: normalized.order ?? 0,
		hasDefault: normalized.default !== undefined,
		editor: resolveSettingsEditorDefinition(normalized),
		...(defaultSummary ? { defaultSummary } : {}),
	};
}