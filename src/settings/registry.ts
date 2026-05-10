import type { z } from "zod";

import {
	normalizeDynamicSettingDefinition,
	serializeDynamicSettingDefinition,
	type DynamicSettingAnyDefinition,
	type DynamicSettingDefinition,
	type SerializedSettingsGroup,
	type SettingsGroupDefinition,
} from "./types";

const settingsRegistry = new Map<string, DynamicSettingAnyDefinition>();
const settingsGroups = new Map<string, SettingsGroupDefinition>();

function sortSettings(left: DynamicSettingAnyDefinition, right: DynamicSettingAnyDefinition): number {
	const leftGroupOrder = left.group?.order ?? 0;
	const rightGroupOrder = right.group?.order ?? 0;
	if (leftGroupOrder !== rightGroupOrder) {
		return leftGroupOrder - rightGroupOrder;
	}

	const leftGroupId = left.group?.id ?? "";
	const rightGroupId = right.group?.id ?? "";
	if (leftGroupId !== rightGroupId) {
		return leftGroupId.localeCompare(rightGroupId);
	}

	const leftOrder = left.order ?? 0;
	const rightOrder = right.order ?? 0;
	if (leftOrder !== rightOrder) {
		return leftOrder - rightOrder;
	}

	return left.id.localeCompare(right.id);
}

function sortGroups(left: SettingsGroupDefinition, right: SettingsGroupDefinition): number {
	if ((left.order ?? 0) !== (right.order ?? 0)) {
		return (left.order ?? 0) - (right.order ?? 0);
	}

	return left.label.localeCompare(right.label);
}

export function defineDynamicSettings<TSchema extends z.ZodTypeAny>(
	definition: DynamicSettingDefinition<TSchema>,
): DynamicSettingDefinition<TSchema> {
	const normalized = normalizeDynamicSettingDefinition(definition);
	if (settingsRegistry.has(normalized.id)) {
		throw new Error(`Dynamic setting '${normalized.id}' is already registered.`);
	}

	settingsRegistry.set(normalized.id, normalized);
	if (normalized.group && !settingsGroups.has(normalized.group.id)) {
		settingsGroups.set(normalized.group.id, normalized.group);
	}

	return normalized;
}

export function getDynamicSettingDefinition(id: string): DynamicSettingAnyDefinition | null {
	return settingsRegistry.get(id.trim()) ?? null;
}

export function listDynamicSettingDefinitions(): DynamicSettingAnyDefinition[] {
	return [...settingsRegistry.values()].sort(sortSettings);
}

export function listDynamicSettingsGroups(): SettingsGroupDefinition[] {
	const counts = new Map<string, number>();
	for (const setting of settingsRegistry.values()) {
		if (!setting.group) {
			continue;
		}

		counts.set(setting.group.id, (counts.get(setting.group.id) ?? 0) + 1);
	}

	return [...settingsGroups.values()]
		.filter((group) => (counts.get(group.id) ?? 0) > 0)
		.sort(sortGroups);
}

export async function listSerializedDynamicSettingsGroups(): Promise<SerializedSettingsGroup[]> {
	const counts = new Map<string, number>();
	for (const setting of settingsRegistry.values()) {
		if (!setting.group) {
			continue;
		}

		counts.set(setting.group.id, (counts.get(setting.group.id) ?? 0) + 1);
	}

	return listDynamicSettingsGroups().map((group) => ({
		id: group.id,
		label: group.label,
		...(group.description ? { description: group.description } : {}),
		order: group.order ?? 0,
		settingCount: counts.get(group.id) ?? 0,
	}));
}

export async function listSerializedDynamicSettingDefinitions() {
	return await Promise.all(listDynamicSettingDefinitions().map(async (definition) => await serializeDynamicSettingDefinition(definition)));
}

export function resetDynamicSettingsRegistry(): void {
	settingsRegistry.clear();
	settingsGroups.clear();
}