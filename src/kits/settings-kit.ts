import { z } from "zod";

import { Result } from "../modules/adapters/result";
import {
	ensureSettingsCatalogLoaded,
	getDynamicSettingDefinition,
	listDynamicSettingDefinitions,
	listSerializedDynamicSettingsGroups,
	serializeDynamicSettingDefinition,
	type DynamicSettingAnyDefinition,
	type ResolvedSettingValue,
	type SerializedResolvedSettingValue,
	type SerializedSettingDefinition,
	type SerializedSettingSnapshot,
	type SettingsCatalogSnapshot,
} from "../settings";
import { Kit, type KitLifecycleContext } from "./kit";
import { $storageKit, type StorageKit, type StoredSettingValueRow } from "./storage-kit";

export const SETTINGS_KIT_ID = "$settings";

type ResolveStoredSettingValueResult = {
	parsed?: { updatedAt: string; value: unknown };
	validationError?: string;
};

function cloneStructuredValue<TValue>(value: TValue): TValue {
	if (value === undefined) {
		return value;
	}

	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
		return value;
	}

	return JSON.parse(JSON.stringify(value)) as TValue;
}

async function resolveSettingDefaultValue<TValue>(definition: DynamicSettingAnyDefinition): Promise<TValue> {
	const defaultValue = typeof definition.default === "function"
		? await (definition.default as (() => unknown | Promise<unknown>))()
		: definition.default;
	if (defaultValue === undefined) {
		throw new Error(`Setting '${definition.id}' has no default value.`);
	}

	const parsed = await definition.type.parseAsync(defaultValue);
	if (definition.validator) {
		await definition.validator(parsed);
	}

	return cloneStructuredValue(parsed) as TValue;
}

function createMissingSettingError(id: string): Error {
	return new Error(`Dynamic setting '${id}' is not registered.`);
}

export class SettingsReadHandle<TValue = unknown> {
	constructor(
		private readonly kit: SettingsKit,
		private readonly id: string,
	) {}

	async result(): Promise<Result<TValue, Error>> {
		try {
			const value = await this.kit.readStoredValue<TValue>(this.id);
			if (value === undefined) {
				return Result.fail(new Error(`Setting '${this.id}' has no stored value.`));
			}

			return Result.ok(value);
		} catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	async unwrap(): Promise<TValue> {
		return (await this.result()).unwrap();
	}

	async unwrapOrDefault(): Promise<TValue> {
		const stored = await this.kit.readStoredValue<TValue>(this.id);
		if (stored !== undefined) {
			return stored;
		}

		return await this.kit.resolveDefaultValue<TValue>(this.id);
	}

	async readResolved(): Promise<ResolvedSettingValue<TValue>> {
		return await this.kit.readResolved<TValue>(this.id);
	}
}

export class SettingsKit extends Kit {
	constructor(private readonly storageKit: StorageKit = $storageKit) {
		super({
			id: SETTINGS_KIT_ID,
			name: "$settings",
			description: "Workspace-scoped dynamic settings registry backed by SQLite values.",
		});
	}

	protected override async onStart(_context: KitLifecycleContext): Promise<void> {
		ensureSettingsCatalogLoaded();
		if (!this.storageKit.isActive()) {
			await this.storageKit.start({ reason: "settings-kit" });
		}
	}

	get<TValue = unknown>(id: string): SettingsReadHandle<TValue> {
		return new SettingsReadHandle<TValue>(this, id);
	}

	async listDefinitions(): Promise<SerializedSettingDefinition[]> {
		await this.ensureReady();
		return await Promise.all(
			listDynamicSettingDefinitions().map(async (definition) => await serializeDynamicSettingDefinition(definition)),
		);
	}

	async listCatalog(): Promise<SettingsCatalogSnapshot> {
		await this.ensureReady();
		const definitions = listDynamicSettingDefinitions();
		const groups = await listSerializedDynamicSettingsGroups();
		const settings: SerializedSettingSnapshot[] = [];

		for (const definition of definitions) {
			const serializedDefinition = await serializeDynamicSettingDefinition(definition);
			const resolved = await this.tryReadResolved(definition);
			settings.push({
				definition: serializedDefinition,
				...(resolved ? { value: this.serializeResolvedSettingValue(resolved) } : {}),
				missing: resolved === null,
			});
		}

		return { groups, settings };
	}

	async readResolved<TValue = unknown>(id: string): Promise<ResolvedSettingValue<TValue>> {
		await this.ensureReady();
		const definition = this.requireDefinition(id);
		const stored = this.resolveStoredSettingValue(definition, this.storageKit.selectSettingValue(definition.id));
		if (stored.parsed) {
			return {
				id: definition.id,
				value: cloneStructuredValue(stored.parsed.value) as TValue,
				source: "stored",
				updatedAt: stored.parsed.updatedAt,
			};
		}

		const defaultValue = await resolveSettingDefaultValue<TValue>(definition);
		return {
			id: definition.id,
			value: defaultValue,
			source: stored.validationError ? "invalid-stored-default" : "default",
			...(stored.validationError ? { validationError: stored.validationError } : {}),
		};
	}

	async readStoredValue<TValue = unknown>(id: string): Promise<TValue | undefined> {
		await this.ensureReady();
		const definition = this.requireDefinition(id);
		const stored = this.resolveStoredSettingValue(definition, this.storageKit.selectSettingValue(definition.id));
		if (!stored.parsed) {
			return undefined;
		}

		return cloneStructuredValue(stored.parsed.value) as TValue;
	}

	async resolveDefaultValue<TValue = unknown>(id: string): Promise<TValue> {
		await this.ensureReady();
		return await resolveSettingDefaultValue<TValue>(this.requireDefinition(id));
	}

	async set<TValue = unknown>(id: string, value: TValue): Promise<ResolvedSettingValue<TValue>> {
		await this.ensureReady();
		const definition = this.requireDefinition(id);
		const parsed = await definition.type.parseAsync(value);
		if (definition.validator) {
			await definition.validator(parsed);
		}

		const updatedAt = new Date().toISOString();
		this.storageKit.upsertSettingValue({
			id: definition.id,
			valueJson: JSON.stringify(parsed),
			updatedAt,
		});

		return {
			id: definition.id,
			value: cloneStructuredValue(parsed) as TValue,
			source: "stored",
			updatedAt,
		};
	}

	async reset(id: string): Promise<boolean> {
		await this.ensureReady();
		this.requireDefinition(id);
		return this.storageKit.deleteSettingValue(id);
	}

	private async ensureReady(): Promise<void> {
		ensureSettingsCatalogLoaded();
		if (!this.isActive()) {
			await this.start({ reason: "settings-kit:auto" });
		}
		if (!this.storageKit.isActive()) {
			await this.storageKit.start({ reason: "settings-kit:storage" });
		}
	}

	private requireDefinition(id: string): DynamicSettingAnyDefinition {
		const definition = getDynamicSettingDefinition(id);
		if (!definition) {
			throw createMissingSettingError(id);
		}

		return definition;
	}

	private resolveStoredSettingValue(
		definition: DynamicSettingAnyDefinition,
		row: StoredSettingValueRow | null,
	): ResolveStoredSettingValueResult {
		if (!row) {
			return {};
		}

		try {
			const parsedJson = JSON.parse(row.value_json) as unknown;
			const parsed = definition.type.parse(parsedJson);
			return {
				parsed: {
					updatedAt: row.updated_at,
					value: parsed,
				},
			};
		} catch (error) {
			const message = error instanceof z.ZodError
				? error.issues.map((issue) => issue.message).join("; ")
				: (error instanceof Error ? error.message : String(error));
			return {
				validationError: `Stored value is invalid: ${message}`,
			};
		}
	}

	private async tryReadResolved(definition: DynamicSettingAnyDefinition): Promise<ResolvedSettingValue | null> {
		const stored = this.resolveStoredSettingValue(definition, this.storageKit.selectSettingValue(definition.id));
		if (stored.parsed) {
			return {
				id: definition.id,
				value: cloneStructuredValue(stored.parsed.value),
				source: "stored",
				updatedAt: stored.parsed.updatedAt,
			};
		}

		if (definition.default === undefined) {
			return null;
		}

		const defaultValue = await resolveSettingDefaultValue(definition);
		return {
			id: definition.id,
			value: defaultValue,
			source: stored.validationError ? "invalid-stored-default" : "default",
			...(stored.validationError ? { validationError: stored.validationError } : {}),
		};
	}

	private serializeResolvedSettingValue(value: ResolvedSettingValue): SerializedResolvedSettingValue {
		return {
			id: value.id,
			value: cloneStructuredValue(value.value),
			source: value.source,
			...(value.updatedAt ? { updatedAt: value.updatedAt } : {}),
			...(value.validationError ? { validationError: value.validationError } : {}),
		};
	}
}

export const $settings = new SettingsKit();