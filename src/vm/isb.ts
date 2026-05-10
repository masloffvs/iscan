import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, normalize } from "node:path";
import { deserialize, serialize } from "node:v8";

import {
  createEmptyRecoverableVmSnapshot,
  isRecoverableVmFileSystemSnapshot,
  normalizeRecoverableVmSnapshotRelativePath,
  type RecoverableVmSnapshot,
  type RecoverableVmSnapshotCell,
} from "../modules";
import { resolveWritableRuntimePath } from "../runtime-paths";

const ISB_MAGIC = "ISB2";
const LEGACY_ISB_MAGIC = "ISCB";
const ISB_VERSION = 2;
const DEFAULT_ISB_DIRECTORY = "workspace";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}

export type IsbNotebookCell = {
  id: string;
  kind: "markdown" | "code" | "sql";
  title: string;
  language?: string;
  executionCount?: number;
  source: string[];
  output?: string[];
};

export type IsbNotebookDocument = {
  id: string;
  title: string;
  path: string;
  kernel: string;
  trusted: boolean;
  summary: string;
  cells: IsbNotebookCell[];
};

export type IsbFile = {
  version: typeof ISB_VERSION;
  relativePath: string;
  notebook: IsbNotebookDocument;
  snapshot: RecoverableVmSnapshot;
  createdAt: number;
  savedAt: number;
};

export type IsbFileListEntry = {
  relativePath: string;
  title: string;
  cellCount: number;
  trusted: boolean;
  savedAt: number;
};

export type IsbFolderEntry = {
  relativePath: string;
};

export type IsbSearchResultEntry = {
  relativePath: string;
  notebookTitle: string;
  cellId: string;
  cellTitle: string;
  cellKind: IsbNotebookCell["kind"];
  cellLanguage?: string;
  preview: string;
  score: number;
};

type IsbSearchIndexEntry = {
  relativePath: string;
  notebookTitle: string;
  notebookSummary: string;
  cellId: string;
  cellTitle: string;
  cellKind: IsbNotebookCell["kind"];
  cellLanguage?: string;
  sourceText: string;
  outputText: string;
  searchText: string;
};

const isbSearchIndexCache = new Map<string, IsbSearchIndexEntry[]>();

function tokenizeSearchQuery(query: string): string[] {
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
}

function truncateSearchPreview(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildSearchPreview(
  sourceText: string,
  outputText: string,
  queryTokens: readonly string[],
): string {
  const candidates = [sourceText, outputText]
    .map((value) => value.replace(/\s+/gu, " ").trim())
    .filter((value) => value.length > 0);

  if (candidates.length === 0) {
    return "Cell has no source or output yet.";
  }

  for (const candidate of candidates) {
    const normalized = candidate.toLocaleLowerCase();
    const matchedToken = queryTokens.find((token) => normalized.includes(token));
    if (!matchedToken) {
      continue;
    }

    const matchIndex = normalized.indexOf(matchedToken);
    const previewStart = Math.max(0, matchIndex - 54);
    const previewEnd = Math.min(candidate.length, matchIndex + matchedToken.length + 96);
    const prefix = previewStart > 0 ? "..." : "";
    const suffix = previewEnd < candidate.length ? "..." : "";
    return `${prefix}${truncateSearchPreview(candidate.slice(previewStart, previewEnd))}${suffix}`;
  }

  return truncateSearchPreview(candidates[0] ?? "");
}

function createIsbSearchIndexEntry(isbFile: IsbFile, cell: IsbNotebookCell): IsbSearchIndexEntry {
  const sourceText = cell.source.join("\n");
  const outputText = (cell.output ?? []).join("\n");

  return {
    relativePath: isbFile.relativePath,
    notebookTitle: isbFile.notebook.title,
    notebookSummary: isbFile.notebook.summary,
    cellId: cell.id,
    cellTitle: cell.title,
    cellKind: cell.kind,
    cellLanguage: cell.language,
    sourceText,
    outputText,
    searchText: [
      isbFile.relativePath,
      isbFile.notebook.title,
      isbFile.notebook.summary,
      cell.id,
      cell.title,
      cell.kind,
      cell.language ?? "",
      sourceText,
      outputText,
    ]
      .filter((value) => value.trim().length > 0)
      .join("\n")
      .toLocaleLowerCase(),
  };
}

function scoreIsbSearchIndexEntry(entry: IsbSearchIndexEntry, query: string, queryTokens: readonly string[]): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  for (const token of queryTokens) {
    if (!entry.searchText.includes(token)) {
      return 0;
    }
  }

  const normalizedCellTitle = entry.cellTitle.toLocaleLowerCase();
  const normalizedNotebookTitle = entry.notebookTitle.toLocaleLowerCase();
  const normalizedPath = entry.relativePath.toLocaleLowerCase();
  const normalizedSource = entry.sourceText.toLocaleLowerCase();
  const normalizedOutput = entry.outputText.toLocaleLowerCase();

  let score = 0;
  if (normalizedCellTitle === query) {
    score += 180;
  }
  if (normalizedCellTitle.startsWith(query)) {
    score += 120;
  }
  if (normalizedNotebookTitle.startsWith(query) || normalizedPath.startsWith(query)) {
    score += 84;
  }

  for (const token of queryTokens) {
    if (normalizedCellTitle.includes(token)) {
      score += 36;
    }
    if (normalizedNotebookTitle.includes(token)) {
      score += 26;
    }
    if (normalizedPath.includes(token)) {
      score += 22;
    }
    if (normalizedSource.includes(token)) {
      score += 18;
    }
    if (normalizedOutput.includes(token)) {
      score += 14;
    }
  }

  return score;
}

function invalidateIsbSearchIndex(): void {
  isbSearchIndexCache.clear();
}

function validateNotebookCell(value: unknown): IsbNotebookCell {
  if (!isRecord(value)) {
    throw new Error("ISB notebook cell must be an object.");
  }

  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new Error("ISB notebook cell is missing a valid id.");
  }

  if (value.kind !== "markdown" && value.kind !== "code" && value.kind !== "sql") {
    throw new Error(`ISB notebook cell has invalid kind: ${String(value.kind)}`);
  }

  if (typeof value.title !== "string") {
    throw new Error("ISB notebook cell is missing its title.");
  }

  if (!Array.isArray(value.source) || !value.source.every((entry) => typeof entry === "string")) {
    throw new Error("ISB notebook cell source must be a string array.");
  }

  if (value.language !== undefined && typeof value.language !== "string") {
    throw new Error("ISB notebook cell language must be a string.");
  }

  if (value.executionCount !== undefined && typeof value.executionCount !== "number") {
    throw new Error("ISB notebook cell executionCount must be a number.");
  }

  if (
    value.output !== undefined
    && (!Array.isArray(value.output) || !value.output.every((entry) => typeof entry === "string"))
  ) {
    throw new Error("ISB notebook cell output must be a string array.");
  }

  return {
    id: value.id,
    kind: value.kind,
    title: value.title,
    language: value.language,
    executionCount: value.executionCount,
    source: [...value.source],
    output: value.output ? [...value.output] : undefined,
  };
}

function validateNotebookDocument(value: unknown, expectedRelativePath: string): IsbNotebookDocument {
  if (!isRecord(value)) {
    throw new Error("ISB notebook document must be an object.");
  }

  if (
    typeof value.id !== "string"
    || typeof value.title !== "string"
    || typeof value.path !== "string"
    || typeof value.kernel !== "string"
    || typeof value.trusted !== "boolean"
    || typeof value.summary !== "string"
    || !Array.isArray(value.cells)
  ) {
    throw new Error("ISB notebook document is invalid.");
  }

  const normalizedPath = normalizeIsbRelativePath(value.path);
  if (normalizedPath !== expectedRelativePath) {
    throw new Error(`ISB notebook path mismatch: expected ${expectedRelativePath}, received ${normalizedPath}`);
  }

  return {
    id: expectedRelativePath,
    title: value.title,
    path: expectedRelativePath,
    kernel: value.kernel,
    trusted: value.trusted,
    summary: value.summary,
    cells: value.cells.map((cell) => validateNotebookCell(cell)),
  };
}

function validateRecoverableVmSnapshotCell(value: unknown): RecoverableVmSnapshotCell {
  if (!isRecord(value)) {
    throw new Error("Recoverable VM snapshot cell must be an object.");
  }

  if (
    typeof value.id !== "string"
    || typeof value.source !== "string"
    || typeof value.transpiled !== "string"
    || typeof value.createdAt !== "number"
  ) {
    throw new Error("Recoverable VM snapshot cell is invalid.");
  }

  return {
    id: value.id,
    source: value.source,
    transpiled: value.transpiled,
    createdAt: value.createdAt,
  };
}

function validateRecoverableVmSnapshot(value: unknown): RecoverableVmSnapshot {
  if (!isRecord(value)) {
    throw new Error("Recoverable VM snapshot must be an object.");
  }

  if (
    value.version !== 1
    || typeof value.relativePath !== "string"
    || typeof value.createdAt !== "number"
    || typeof value.savedAt !== "number"
    || !Array.isArray(value.cells)
    || !isRecoverableVmFileSystemSnapshot(value.filesystem)
  ) {
    throw new Error("Recoverable VM snapshot payload is invalid.");
  }

  return {
    version: 1,
    relativePath: normalizeRecoverableVmSnapshotRelativePath(value.relativePath),
    createdAt: value.createdAt,
    savedAt: value.savedAt,
    cells: value.cells.map((cell) => validateRecoverableVmSnapshotCell(cell)),
    filesystem: value.filesystem,
  };
}

function validateIsbFile(value: unknown, expectedRelativePath: string): IsbFile {
  if (!isRecord(value)) {
    throw new Error("ISB file must be an object.");
  }

  if (
    value.version !== ISB_VERSION
    || typeof value.relativePath !== "string"
    || typeof value.createdAt !== "number"
    || typeof value.savedAt !== "number"
  ) {
    throw new Error("ISB file payload is invalid.");
  }

  const relativePath = normalizeIsbRelativePath(value.relativePath);
  if (relativePath !== expectedRelativePath) {
    throw new Error(`ISB file path mismatch: expected ${expectedRelativePath}, received ${relativePath}`);
  }

  return {
    version: ISB_VERSION,
    relativePath,
    notebook: validateNotebookDocument(value.notebook, relativePath),
    snapshot: validateRecoverableVmSnapshot(value.snapshot),
    createdAt: value.createdAt,
    savedAt: value.savedAt,
  };
}

function createDefaultNotebookTitle(relativePath: string): string {
  const filename = basename(relativePath, ".isb");
  if (filename.length === 0) {
    return "Untitled Notebook";
  }

  return filename
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

export function normalizeIsbRelativePath(filePath: string): string {
  const trimmedPath = filePath.trim();
  if (trimmedPath.length === 0) {
    throw new Error("ISB path cannot be empty.");
  }

  if (isAbsolute(trimmedPath)) {
    throw new Error("ISB path must be relative to the data directory.");
  }

  const normalizedPath = normalize(trimmedPath).replace(/\\/gu, "/");
  if (normalizedPath === "." || normalizedPath === "" || normalizedPath === "..") {
    throw new Error("ISB path must point to a file inside data/.");
  }

  if (normalizedPath.startsWith("../")) {
    throw new Error("ISB path cannot escape the data directory.");
  }

  if (extname(normalizedPath) !== ".isb") {
    throw new Error(`ISB path must end with .isb: ${filePath}`);
  }

  return normalizedPath;
}

export function normalizeIsbDirectoryPath(directoryPath: string): string {
  const trimmedPath = directoryPath.trim();
  if (trimmedPath.length === 0) {
    throw new Error("ISB directory path cannot be empty.");
  }

  if (isAbsolute(trimmedPath)) {
    throw new Error("ISB directory path must be relative to the data directory.");
  }

  const normalizedPath = normalize(trimmedPath).replace(/\\/gu, "/");
  if (normalizedPath === "." || normalizedPath === "" || normalizedPath === "..") {
    throw new Error("ISB directory path must point to a folder inside data/.");
  }

  if (normalizedPath.startsWith("../")) {
    throw new Error("ISB directory path cannot escape the data directory.");
  }

  if (extname(normalizedPath) === ".isb") {
    throw new Error(`ISB directory path must point to a directory: ${directoryPath}`);
  }

  return normalizedPath;
}

export function resolveIsbFilePath(relativePath: string): { relativePath: string; filePath: string } {
  const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
  return {
    relativePath: normalizedRelativePath,
    filePath: resolveWritableRuntimePath("data", normalizedRelativePath),
  };
}

export function resolveIsbDirectoryPath(relativePath: string): { relativePath: string; filePath: string } {
  const normalizedRelativePath = normalizeIsbDirectoryPath(relativePath);
  return {
    relativePath: normalizedRelativePath,
    filePath: resolveWritableRuntimePath("data", normalizedRelativePath),
  };
}

export function getDefaultIsbDirectory(): string {
  return DEFAULT_ISB_DIRECTORY;
}

export function createIsbSnapshotTemplatePath(relativePath: string): string {
  const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
  return normalizeRecoverableVmSnapshotRelativePath(
    `isb-snapshots/${normalizedRelativePath}.bin`,
  );
}

export function rebaseRecoverableVmSnapshot(
  snapshot: RecoverableVmSnapshot,
  nextRelativePath: string,
): RecoverableVmSnapshot {
  return {
    ...snapshot,
    relativePath: normalizeRecoverableVmSnapshotRelativePath(nextRelativePath),
    cells: [...snapshot.cells],
  };
}

export function createDefaultIsbNotebook(relativePath: string): IsbNotebookDocument {
  const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
  return {
    id: normalizedRelativePath,
    title: createDefaultNotebookTitle(normalizedRelativePath),
    path: normalizedRelativePath,
    kernel: "Recoverable VM",
    trusted: true,
    summary: "",
    cells: [
      {
        id: "cell-1",
        kind: "code",
        title: "Cell 1",
        language: "javascript",
        source: [""],
      },
    ],
  };
}

export function createEmptyIsbFile(relativePath: string): IsbFile {
  const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
  const now = Date.now();
  return {
    version: ISB_VERSION,
    relativePath: normalizedRelativePath,
    notebook: createDefaultIsbNotebook(normalizedRelativePath),
    snapshot: createEmptyRecoverableVmSnapshot(createIsbSnapshotTemplatePath(normalizedRelativePath)),
    createdAt: now,
    savedAt: now,
  };
}

export function retargetIsbFile(isbFile: IsbFile, nextRelativePath: string): IsbFile {
  const normalizedRelativePath = normalizeIsbRelativePath(nextRelativePath);

  return {
    ...isbFile,
    relativePath: normalizedRelativePath,
    notebook: {
      ...isbFile.notebook,
      id: normalizedRelativePath,
      path: normalizedRelativePath,
    },
    snapshot: rebaseRecoverableVmSnapshot(
      isbFile.snapshot,
      createIsbSnapshotTemplatePath(normalizedRelativePath),
    ),
    savedAt: Date.now(),
  };
}

function decodeLegacyNotebook(relativePath: string, payload: Uint8Array): IsbFile {
  const jsonPayload = JSON.parse(new TextDecoder().decode(payload)) as unknown;
  const notebook = validateNotebookDocument(jsonPayload, normalizeIsbRelativePath(relativePath));
  const now = Date.now();
  return {
    version: ISB_VERSION,
    relativePath: notebook.path,
    notebook,
    snapshot: createEmptyRecoverableVmSnapshot(createIsbSnapshotTemplatePath(notebook.path)),
    createdAt: now,
    savedAt: now,
  };
}

export async function readIsbFile(relativePath: string): Promise<IsbFile> {
  const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
  const { filePath } = resolveIsbFilePath(normalizedRelativePath);

  try {
    const fileBuffer = await readFile(filePath);
    const magic = fileBuffer.subarray(0, 4).toString("utf8");
    const payload = fileBuffer.subarray(4);

    if (magic === LEGACY_ISB_MAGIC) {
      return decodeLegacyNotebook(normalizedRelativePath, payload);
    }

    if (magic !== ISB_MAGIC) {
      throw new Error(`Unsupported ISB header: ${magic}`);
    }

    return validateIsbFile(deserialize(payload), normalizedRelativePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`ISB file not found: ${normalizedRelativePath}`);
    }

    throw new Error(`Failed to read ISB file "${normalizedRelativePath}": ${buildErrorMessage(error)}`);
  }
}

export async function writeIsbFile(isbFile: IsbFile): Promise<void> {
  const validatedFile = validateIsbFile(isbFile, isbFile.relativePath);
  const { filePath } = resolveIsbFilePath(validatedFile.relativePath);
  const tempFilePath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const payload = Buffer.concat([
    Buffer.from(ISB_MAGIC, "utf8"),
    Buffer.from(serialize(validatedFile)),
  ]);

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tempFilePath, payload);

  try {
    await rename(tempFilePath, filePath);
    invalidateIsbSearchIndex();
  } finally {
    await rm(tempFilePath, { force: true }).catch(() => undefined);
  }
}

export async function createIsbFolder(relativePath: string): Promise<IsbFolderEntry> {
  const { relativePath: normalizedRelativePath, filePath } = resolveIsbDirectoryPath(relativePath);
  await mkdir(filePath, { recursive: true });
  invalidateIsbSearchIndex();
  return { relativePath: normalizedRelativePath };
}

export async function deleteIsbFile(relativePath: string): Promise<void> {
  const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
  const { filePath } = resolveIsbFilePath(normalizedRelativePath);

  try {
    await rm(filePath);
    invalidateIsbSearchIndex();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`ISB file not found: ${normalizedRelativePath}`);
    }

    throw new Error(`Failed to delete ISB file "${normalizedRelativePath}": ${buildErrorMessage(error)}`);
  }
}

export async function moveIsbFile(relativePath: string, targetPath: string): Promise<IsbFile> {
  const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
  const nextFile = retargetIsbFile(await readIsbFile(normalizedRelativePath), targetPath);

  await writeIsbFile(nextFile);
  try {
    await deleteIsbFile(normalizedRelativePath);
  } catch (error) {
    await deleteIsbFile(nextFile.relativePath).catch(() => undefined);
    throw error;
  }

  return nextFile;
}

async function collectIsbFilePaths(directoryPath: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const relativeEntryPath = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      paths.push(...await collectIsbFilePaths(`${directoryPath}/${entry.name}`, relativeEntryPath));
      continue;
    }

    if (entry.isFile() && extname(entry.name) === ".isb") {
      paths.push(relativeEntryPath);
    }
  }

  return paths;
}

async function collectIsbDirectoryPaths(directoryPath: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const relativeEntryPath = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
    paths.push(relativeEntryPath);
    paths.push(...await collectIsbDirectoryPaths(`${directoryPath}/${entry.name}`, relativeEntryPath));
  }

  return paths;
}

async function getIsbSearchIndex(rootDirectory = DEFAULT_ISB_DIRECTORY): Promise<IsbSearchIndexEntry[]> {
  const normalizedRootDirectory = normalize(rootDirectory).replace(/\\/gu, "/");
  const cachedEntries = isbSearchIndexCache.get(normalizedRootDirectory);
  if (cachedEntries) {
    return cachedEntries;
  }

  const rootPath = resolveWritableRuntimePath("data", normalizedRootDirectory);
  try {
    const relativePaths = await collectIsbFilePaths(rootPath, normalizedRootDirectory);
    const entries = (await Promise.all(relativePaths.map(async (relativePath) => {
      const isbFile = await readIsbFile(relativePath);
      return isbFile.notebook.cells.map((cell) => createIsbSearchIndexEntry(isbFile, cell));
    }))).flat();

    isbSearchIndexCache.set(normalizedRootDirectory, entries);
    return entries;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      isbSearchIndexCache.set(normalizedRootDirectory, []);
      return [];
    }

    throw new Error(`Failed to build ISB search index: ${buildErrorMessage(error)}`);
  }
}

export async function listIsbFiles(rootDirectory = DEFAULT_ISB_DIRECTORY): Promise<IsbFileListEntry[]> {
  const normalizedRootDirectory = normalize(rootDirectory).replace(/\\/gu, "/");
  const rootPath = resolveWritableRuntimePath("data", normalizedRootDirectory);

  try {
    const relativePaths = await collectIsbFilePaths(rootPath, normalizedRootDirectory);
    const files = await Promise.all(relativePaths.map(async (relativePath) => {
      const isbFile = await readIsbFile(relativePath);
      return {
        relativePath: isbFile.relativePath,
        title: isbFile.notebook.title,
        cellCount: isbFile.notebook.cells.length,
        trusted: isbFile.notebook.trusted,
        savedAt: isbFile.savedAt,
      } satisfies IsbFileListEntry;
    }));

    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw new Error(`Failed to list ISB files: ${buildErrorMessage(error)}`);
  }
}

export async function listIsbFolders(rootDirectory = DEFAULT_ISB_DIRECTORY): Promise<IsbFolderEntry[]> {
  const normalizedRootDirectory = normalizeIsbDirectoryPath(rootDirectory);
  const rootPath = resolveWritableRuntimePath("data", normalizedRootDirectory);

  try {
    const relativePaths = [
      normalizedRootDirectory,
      ...await collectIsbDirectoryPaths(rootPath, normalizedRootDirectory),
    ];

    return [...new Set(relativePaths)]
      .sort((left, right) => left.localeCompare(right))
      .map((relativePath) => ({ relativePath } satisfies IsbFolderEntry));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw new Error(`Failed to list ISB folders: ${buildErrorMessage(error)}`);
  }
}

export async function searchIsbFiles(
  query: string,
  options: { limit?: number; rootDirectory?: string } = {},
): Promise<IsbSearchResultEntry[]> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const queryTokens = tokenizeSearchQuery(normalizedQuery);
  if (queryTokens.length === 0) {
    return [];
  }

  const requestedLimit = options.limit ?? 12;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 50))
    : 12;
  const indexEntries = await getIsbSearchIndex(options.rootDirectory);

  return indexEntries
    .map((entry) => ({
      entry,
      score: scoreIsbSearchIndexEntry(entry, normalizedQuery, queryTokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.entry.relativePath !== right.entry.relativePath) {
        return left.entry.relativePath.localeCompare(right.entry.relativePath);
      }

      return left.entry.cellId.localeCompare(right.entry.cellId);
    })
    .slice(0, limit)
    .map(({ entry, score }) => ({
      relativePath: entry.relativePath,
      notebookTitle: entry.notebookTitle,
      cellId: entry.cellId,
      cellTitle: entry.cellTitle,
      cellKind: entry.cellKind,
      cellLanguage: entry.cellLanguage,
      preview: buildSearchPreview(entry.sourceText, entry.outputText, queryTokens),
      score,
    } satisfies IsbSearchResultEntry));
}