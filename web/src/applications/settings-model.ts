import {
  type RemoteResolvedSettingValue,
  type RemoteSettingDefinition,
  type RemoteSettingSnapshot,
  type RemoteSettingsCatalog,
} from "../api/client";

export type SettingsDraftValue = string | boolean;

export function formatDraftValue(snapshot: RemoteSettingSnapshot): SettingsDraftValue {
  const { editor } = snapshot.definition;
  const value = snapshot.value?.value;

  if (editor.kind === "boolean") {
    return value === true;
  }

  if (editor.kind === "number") {
    return typeof value === "number" ? String(value) : "";
  }

  if (editor.kind === "string[]") {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string").join("\n")
      : "";
  }

  if (editor.kind === "json") {
    if (value === undefined) {
      return "";
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return typeof value === "string" ? value : "";
}

export function createDraftMap(catalog: RemoteSettingsCatalog): Record<string, SettingsDraftValue> {
  return Object.fromEntries(
    catalog.settings.map((snapshot) => [snapshot.definition.id, formatDraftValue(snapshot)]),
  );
}

export function applySettingValue(
  catalog: RemoteSettingsCatalog | null,
  id: string,
  value: RemoteResolvedSettingValue,
): RemoteSettingsCatalog | null {
  if (!catalog) {
    return catalog;
  }

  return {
    ...catalog,
    settings: catalog.settings.map((snapshot) => snapshot.definition.id === id
      ? {
          ...snapshot,
          value,
          missing: false,
        }
      : snapshot),
  };
}

export function parseDraftValue(definition: RemoteSettingDefinition, draft: SettingsDraftValue): unknown {
  const { editor } = definition;

  if (editor.kind === "boolean") {
    return draft === true;
  }

  const rawValue = String(draft);
  if (editor.kind === "string") {
    return rawValue;
  }

  if (editor.kind === "number") {
    if (rawValue.trim().length === 0) {
      throw new Error(`Setting '${definition.label}' requires a numeric value.`);
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Setting '${definition.label}' must be a valid number.`);
    }

    return parsed;
  }

  if (editor.kind === "enum") {
    return rawValue;
  }

  if (editor.kind === "string[]") {
    return rawValue
      .split(/\r?\n|,/gu)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  if (editor.kind === "json") {
    if (rawValue.trim().length === 0) {
      throw new Error(`Setting '${definition.label}' requires JSON input.`);
    }

    try {
      return JSON.parse(rawValue) as unknown;
    } catch (error) {
      throw new Error(`Setting '${definition.label}' contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return rawValue;
}