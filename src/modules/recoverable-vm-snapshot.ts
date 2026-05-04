import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";
import { deserialize, serialize } from "node:v8";

import { resolveWritableRuntimePath } from "../runtime-paths";
import {
  isRecoverableVmFileSystemSnapshot,
  type RecoverableVmFileSystemSnapshot,
} from "./recoverable-vm-fs";

const RECOVERABLE_VM_SNAPSHOT_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}

export type RecoverableVmSnapshotCell = {
  id: string;
  source: string;
  transpiled: string;
  createdAt: number;
};

export type RecoverableVmSnapshot = {
  version: typeof RECOVERABLE_VM_SNAPSHOT_VERSION;
  relativePath: string;
  createdAt: number;
  savedAt: number;
  cells: RecoverableVmSnapshotCell[];
  filesystem: RecoverableVmFileSystemSnapshot;
};

export function normalizeRecoverableVmSnapshotRelativePath(
  snapshotPath: string,
): string {
  const trimmed = snapshotPath.trim();
  if (trimmed.length === 0) {
    throw new Error("Recoverable VM snapshot path cannot be empty.");
  }

  if (isAbsolute(trimmed)) {
    throw new Error("Recoverable VM snapshot path must be relative to the data directory.");
  }

  const normalized = normalize(trimmed).replace(/\\/gu, "/");
  if (normalized === "." || normalized === "" || normalized === "..") {
    throw new Error("Recoverable VM snapshot path must point to a file inside data/.");
  }

  if (normalized.startsWith("../")) {
    throw new Error("Recoverable VM snapshot path cannot escape the data directory.");
  }

  return normalized;
}

export function resolveRecoverableVmSnapshotFilePath(snapshotPath: string): {
  relativePath: string;
  filePath: string;
} {
  const relativePath = normalizeRecoverableVmSnapshotRelativePath(snapshotPath);
  return {
    relativePath,
    filePath: resolveWritableRuntimePath("data", relativePath),
  };
}

export function createEmptyRecoverableVmSnapshot(
  snapshotPath: string,
): RecoverableVmSnapshot {
  const { relativePath } = resolveRecoverableVmSnapshotFilePath(snapshotPath);
  const now = Date.now();
  return {
    version: RECOVERABLE_VM_SNAPSHOT_VERSION,
    relativePath,
    createdAt: now,
    savedAt: now,
    cells: [],
    filesystem: {
      version: 1,
      directories: [{ path: "/", mtimeMs: now }],
      files: [],
    },
  };
}

export async function loadRecoverableVmSnapshot(
  snapshotPath: string,
): Promise<RecoverableVmSnapshot> {
  const { relativePath, filePath } = resolveRecoverableVmSnapshotFilePath(snapshotPath);

  try {
    const payload = await readFile(filePath);
    return validateRecoverableVmSnapshot(deserialize(payload), relativePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return createEmptyRecoverableVmSnapshot(relativePath);
    }

    throw new Error(
      `Failed to load recoverable VM snapshot "${relativePath}": ${buildErrorMessage(error)}`,
    );
  }
}

export async function saveRecoverableVmSnapshot(
  snapshot: RecoverableVmSnapshot,
): Promise<void> {
  const validatedSnapshot = validateRecoverableVmSnapshot(snapshot, snapshot.relativePath);
  const { filePath } = resolveRecoverableVmSnapshotFilePath(validatedSnapshot.relativePath);
  const tempFilePath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tempFilePath, Buffer.from(serialize(validatedSnapshot)));

  try {
    await rename(tempFilePath, filePath);
  } finally {
    await rm(tempFilePath, { force: true }).catch(() => undefined);
  }
}

function validateRecoverableVmSnapshotCell(
  value: unknown,
): RecoverableVmSnapshotCell | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string"
    || typeof value.source !== "string"
    || typeof value.transpiled !== "string"
    || typeof value.createdAt !== "number"
  ) {
    return null;
  }

  return {
    id: value.id,
    source: value.source,
    transpiled: value.transpiled,
    createdAt: value.createdAt,
  };
}

function validateRecoverableVmSnapshot(
  value: unknown,
  expectedRelativePath: string,
): RecoverableVmSnapshot {
  if (!isRecord(value)) {
    throw new Error("Recoverable VM snapshot is not an object.");
  }

  if (value.version !== RECOVERABLE_VM_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported recoverable VM snapshot version: ${String(value.version)}`);
  }

  if (typeof value.relativePath !== "string") {
    throw new Error("Recoverable VM snapshot is missing its relative path.");
  }

  const relativePath = normalizeRecoverableVmSnapshotRelativePath(value.relativePath);
  if (relativePath !== normalizeRecoverableVmSnapshotRelativePath(expectedRelativePath)) {
    throw new Error(
      `Recoverable VM snapshot path mismatch: expected ${expectedRelativePath}, received ${relativePath}`,
    );
  }

  if (typeof value.createdAt !== "number" || typeof value.savedAt !== "number") {
    throw new Error("Recoverable VM snapshot timestamps are invalid.");
  }

  if (!Array.isArray(value.cells)) {
    throw new Error("Recoverable VM snapshot cells are invalid.");
  }

  const cells = value.cells.map((entry) => {
    const normalizedEntry = validateRecoverableVmSnapshotCell(entry);
    if (!normalizedEntry) {
      throw new Error("Recoverable VM snapshot contains an invalid cell record.");
    }

    return normalizedEntry;
  });

  if (!isRecoverableVmFileSystemSnapshot(value.filesystem)) {
    throw new Error("Recoverable VM snapshot filesystem payload is invalid.");
  }

  return {
    version: RECOVERABLE_VM_SNAPSHOT_VERSION,
    relativePath,
    createdAt: value.createdAt,
    savedAt: value.savedAt,
    cells,
    filesystem: value.filesystem,
  };
}