import { Buffer } from "node:buffer";
import type { JsonValue } from "./types";

export const VM_SERVER_SNAPSHOT_PREFIX = "vmserver";

export function createSnapshotPath(code: string): string {
  return `${VM_SERVER_SNAPSHOT_PREFIX}/${code}.bin`;
}

export function decodeSocketMessage(message: string | Buffer | ArrayBuffer | Uint8Array): string {
  if (typeof message === "string") {
    return message;
  }

  return Buffer.from(message instanceof Uint8Array ? message : message).toString("utf8");
}

const VM_RESULT_MAX_DEPTH = 10;

export function serializeVmResult(value: unknown, depth = 0, seen = new WeakSet<object>()): JsonValue {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value === "boolean"
    || typeof value === "number"
    || typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ?? "",
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof RegExp || value instanceof URL) {
    return String(value);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("base64");
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64");
  }

  if (Array.isArray(value)) {
    if (depth >= VM_RESULT_MAX_DEPTH) {
      return value.map((entry) => String(entry));
    }

    return value.map((entry) => serializeVmResult(entry, depth + 1, seen));
  }

  if (value instanceof Map) {
    const entries: Record<string, JsonValue> = {};
    for (const [key, entryValue] of value.entries()) {
      entries[String(key)] = serializeVmResult(entryValue, depth + 1, seen);
    }
    return entries;
  }

  if (value instanceof Set) {
    return [...value].map((entry) => serializeVmResult(entry, depth + 1, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    if (depth >= VM_RESULT_MAX_DEPTH) {
      return String(value);
    }

    const entries: Record<string, JsonValue> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      entries[key] = serializeVmResult(entryValue, depth + 1, seen);
    }

    return entries;
  }

  return String(value);
}
