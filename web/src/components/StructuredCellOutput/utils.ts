import {
  type OutputEntity,
  type BpkgCommandResultValue,
  type NmapParsedResponseValue,
  type DockerWorkingDirectoryValue,
  type DockerCommandResultValue,
  type OutputTone,
  type PrimitiveTableColumn,
  type PrimitiveCellValue,
} from "./types";

export function unwrapComponentModule<T>(value: T): T {
  let current: unknown = value;
  while (current && typeof current === "object" && "default" in current) {
    current = (current as { default: unknown }).default;
  }
  return current as T;
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isOutputEntity(value: unknown): value is OutputEntity {
  if (!isObjectRecord(value)) {
    return false;
  }
  return typeof value.id === "string"
    && typeof value.createdAt === "number"
    && typeof value.kind === "string"
    && isObjectRecord(value.presentation)
    && typeof value.presentation.kind === "string";
}

export function normalizeOutputEntities(value: unknown): OutputEntity[] | null {
  if (isOutputEntity(value)) {
    return [value];
  }
  if (Array.isArray(value) && value.every(isOutputEntity)) {
    return value;
  }
  return null;
}

export function isBpkgCommandResultValue(value: unknown): value is BpkgCommandResultValue {
  if (!isObjectRecord(value)) {
    return false;
  }
  return typeof value.boxId === "string"
    && isStringArray(value.command)
    && typeof value.commandString === "string"
    && typeof value.exitCode === "number"
    && typeof value.stdout === "string"
    && typeof value.stderr === "string";
}

export function isNmapParsedResponseValue(value: unknown): value is NmapParsedResponseValue {
  return isObjectRecord(value)
    && value.kind === "nmap-report"
    && typeof value.target === "string"
    && isObjectRecord(value.report);
}

export function isDockerWorkingDirectoryValue(value: unknown): value is DockerWorkingDirectoryValue {
  return isObjectRecord(value)
    && typeof value.dataRoot === "string"
    && typeof value.logicalPath === "string"
    && typeof value.realPath === "string";
}

export function isDockerCommandResultValue(value: unknown): value is DockerCommandResultValue {
  if (!isObjectRecord(value)) {
    return false;
  }
  return isStringArray(value.command)
    && value.command[0] === "docker"
    && typeof value.commandString === "string"
    && typeof value.exitCode === "number"
    && typeof value.stdout === "string"
    && typeof value.stderr === "string"
    && isDockerWorkingDirectoryValue(value.cwd);
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isObjectRecord);
}

export function hasMeaningfulText(value: string): boolean {
  return value.trim().length > 0;
}

export function countOutputLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  return value.replace(/\n$/u, "").split(/\r?\n/u).length;
}

export function toneClassName(tone: OutputTone | undefined): string {
  switch (tone) {
    case "accent": return "text-[#a7c7ff]";
    case "info": return "text-[#8ac6ff]";
    case "error": return "text-[#fca5a5]";
    case "muted": return "text-[#7b7b84]";
    case "command": return "text-[#f5d08a]";
    default: return "text-[#e4e4e7]";
  }
}

export function alignClassName(align: PrimitiveTableColumn["align"]): string {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

export function formatPrimitiveValue(value: PrimitiveCellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

export function formatCopyCellValue(value: PrimitiveCellValue): string {
  return formatPrimitiveValue(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}
