import { InvalidParamsError } from "../errors";
import { defineNotebookTypeOverlay, type ModuleExecutionContext } from "../module";
import { UA_KIT_ID, UaKit } from "../../kits";

export const UA_NOTEBOOK_TYPE_OVERLAY = defineNotebookTypeOverlay("src/modules/kits/ua.h.ts");

export async function ensureUaKit(
  context: ModuleExecutionContext<unknown, object>,
  reason: string,
): Promise<UaKit> {
  let kit = context.runtime.getKit<UaKit>(UA_KIT_ID);
  if (!kit) {
    kit = new UaKit();
    await context.runtime.attachKit(kit, { reason });
  }

  return kit;
}

export function parseOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new InvalidParamsError(`${fieldName} must be a string.`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function parseOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((entry) => parseOptionalString(entry, fieldName))
      .filter((entry): entry is string => Boolean(entry));
    return items.length > 0 ? [...new Set(items)] : undefined;
  }

  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return items.length > 0 ? [...new Set(items)] : undefined;
  }

  throw new InvalidParamsError(`${fieldName} must be a string or an array of strings.`);
}

export function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new InvalidParamsError(`${fieldName} must be a positive integer.`);
  }

  return numericValue;
}