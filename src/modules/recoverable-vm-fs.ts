import { Buffer } from "node:buffer";
import { posix as path } from "node:path";

const RECOVERABLE_VM_FS_SNAPSHOT_VERSION = 1;

type RecoverableVmFsMeta = {
  mtimeMs: number;
};

type RecoverableVmFsFileEntry = RecoverableVmFsMeta & {
  data: Uint8Array;
};

type RecoverableVmFileSystemOptions = {
  onChange?: () => void;
};

export type RecoverableVmFileSystemSnapshot = {
  version: typeof RECOVERABLE_VM_FS_SNAPSHOT_VERSION;
  directories: Array<{
    path: string;
    mtimeMs: number;
  }>;
  files: Array<{
    path: string;
    data: Uint8Array;
    mtimeMs: number;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createFsError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function cloneUint8Array(data: Uint8Array): Uint8Array {
  return Uint8Array.from(data);
}

function normalizeVmPath(filePath: string): string {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    throw createFsError("EINVAL", "Virtual filesystem path cannot be empty.");
  }

  if (!trimmed.startsWith("/")) {
    throw createFsError(
      "EINVAL",
      `Virtual filesystem path must be absolute: ${filePath}`,
    );
  }

  const normalized = path.normalize(trimmed);
  if (!normalized.startsWith("/")) {
    throw createFsError(
      "EINVAL",
      `Virtual filesystem path escapes the VM root: ${filePath}`,
    );
  }

  return normalized;
}

function toUint8Array(data: string | ArrayBufferView | ArrayBuffer): Uint8Array {
  if (typeof data === "string") {
    return Uint8Array.from(Buffer.from(data));
  }

  if (data instanceof ArrayBuffer) {
    return Uint8Array.from(new Uint8Array(data));
  }

  return Uint8Array.from(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  );
}

function readEncoding(value?: BufferEncoding | { encoding?: BufferEncoding | null } | null): BufferEncoding | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return value.encoding ?? null;
}

export function isRecoverableVmFileSystemSnapshot(
  value: unknown,
): value is RecoverableVmFileSystemSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  if (value.version !== RECOVERABLE_VM_FS_SNAPSHOT_VERSION) {
    return false;
  }

  if (!Array.isArray(value.directories) || !Array.isArray(value.files)) {
    return false;
  }

  return value.directories.every((entry) =>
    isRecord(entry)
    && typeof entry.path === "string"
    && typeof entry.mtimeMs === "number",
  ) && value.files.every((entry) =>
    isRecord(entry)
    && typeof entry.path === "string"
    && typeof entry.mtimeMs === "number"
    && entry.data instanceof Uint8Array,
  );
}

export class RecoverableVmFsStats {
  readonly size: number;
  readonly mtimeMs: number;

  constructor(
    private readonly kind: "file" | "directory",
    options: { size?: number; mtimeMs: number },
  ) {
    this.size = options.size ?? 0;
    this.mtimeMs = options.mtimeMs;
  }

  isFile(): boolean {
    return this.kind === "file";
  }

  isDirectory(): boolean {
    return this.kind === "directory";
  }
}

/**
 * Snapshot-backed filesystem scoped to the current recoverable notebook VM.
 *
 * It is exposed inside notebook code as bare `fs` / `vfs` globals and as the
 * discoverable `$vm.fs` namespace. Writes persist into the notebook snapshot.
 */
export class RecoverableVmFileSystem {
  private readonly directories = new Map<string, RecoverableVmFsMeta>();
  private readonly files = new Map<string, RecoverableVmFsFileEntry>();
  readonly promises: {
    access: (targetPath: string) => Promise<void>;
    mkdir: (dirPath: string, options?: { recursive?: boolean }) => Promise<void>;
    readFile: (
      filePath: string,
      options?: BufferEncoding | { encoding?: BufferEncoding | null } | null,
    ) => Promise<string | Buffer>;
    readdir: (dirPath: string) => Promise<string[]>;
    rm: (targetPath: string, options?: { force?: boolean; recursive?: boolean }) => Promise<void>;
    stat: (targetPath: string) => Promise<RecoverableVmFsStats>;
    unlink: (filePath: string) => Promise<void>;
    writeFile: (
      filePath: string,
      data: string | ArrayBufferView | ArrayBuffer,
    ) => Promise<void>;
  };

  constructor(private readonly options: RecoverableVmFileSystemOptions = {}) {
    const now = Date.now();
    this.directories.set("/", { mtimeMs: now });
    this.promises = {
      access: async (targetPath) => {
        this.accessSync(targetPath);
      },
      mkdir: async (dirPath, mkdirOptions) => {
        this.mkdirSync(dirPath, mkdirOptions);
      },
      readFile: async (filePath, readOptions) =>
        this.readFileSync(filePath, readOptions),
      readdir: async (dirPath) => this.readdirSync(dirPath),
      rm: async (targetPath, rmOptions) => {
        this.rmSync(targetPath, rmOptions);
      },
      stat: async (targetPath) => this.statSync(targetPath),
      unlink: async (filePath) => {
        this.unlinkSync(filePath);
      },
      writeFile: async (filePath, data) => {
        this.writeFileSync(filePath, data);
      },
    };
  }

  normalizePath(filePath: string): string {
    return normalizeVmPath(filePath);
  }

  snapshot(): RecoverableVmFileSystemSnapshot {
    return {
      version: RECOVERABLE_VM_FS_SNAPSHOT_VERSION,
      directories: [...this.directories.entries()]
        .map(([directoryPath, entry]) => ({
          path: directoryPath,
          mtimeMs: entry.mtimeMs,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
      files: [...this.files.entries()]
        .map(([filePath, entry]) => ({
          path: filePath,
          data: cloneUint8Array(entry.data),
          mtimeMs: entry.mtimeMs,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    };
  }

  importSnapshot(snapshot: RecoverableVmFileSystemSnapshot): void {
    if (!isRecoverableVmFileSystemSnapshot(snapshot)) {
      throw createFsError("EINVAL", "Invalid recoverable VM filesystem snapshot.");
    }

    this.directories.clear();
    this.files.clear();

    for (const directory of snapshot.directories) {
      this.directories.set(normalizeVmPath(directory.path), {
        mtimeMs: directory.mtimeMs,
      });
    }

    if (!this.directories.has("/")) {
      this.directories.set("/", { mtimeMs: Date.now() });
    }

    for (const file of snapshot.files) {
      this.files.set(normalizeVmPath(file.path), {
        data: cloneUint8Array(file.data),
        mtimeMs: file.mtimeMs,
      });
    }
  }

  existsSync(targetPath: string): boolean {
    const normalizedPath = normalizeVmPath(targetPath);
    return this.directories.has(normalizedPath) || this.files.has(normalizedPath);
  }

  accessSync(targetPath: string): void {
    if (!this.existsSync(targetPath)) {
      throw createFsError("ENOENT", `No such file or directory: ${targetPath}`);
    }
  }

  statSync(targetPath: string): RecoverableVmFsStats {
    const normalizedPath = normalizeVmPath(targetPath);
    const directory = this.directories.get(normalizedPath);
    if (directory) {
      return new RecoverableVmFsStats("directory", { mtimeMs: directory.mtimeMs });
    }

    const file = this.files.get(normalizedPath);
    if (file) {
      return new RecoverableVmFsStats("file", {
        size: file.data.byteLength,
        mtimeMs: file.mtimeMs,
      });
    }

    throw createFsError("ENOENT", `No such file or directory: ${targetPath}`);
  }

  mkdirSync(dirPath: string, options: { recursive?: boolean } = {}): void {
    const normalizedPath = normalizeVmPath(dirPath);
    if (this.files.has(normalizedPath)) {
      throw createFsError("EEXIST", `Cannot create directory over file: ${dirPath}`);
    }

    if (this.directories.has(normalizedPath)) {
      return;
    }

    const segments = normalizedPath.split("/").filter(Boolean);
    let currentPath = "/";
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      currentPath = currentPath === "/" ? `/${segment}` : `${currentPath}/${segment}`;
      if (this.files.has(currentPath)) {
        throw createFsError("ENOTDIR", `Parent path is a file: ${currentPath}`);
      }

      if (this.directories.has(currentPath)) {
        continue;
      }

      if (!options.recursive && index !== segments.length - 1) {
        throw createFsError("ENOENT", `Missing parent directory for: ${dirPath}`);
      }

      this.directories.set(currentPath, { mtimeMs: Date.now() });
    }

    this.touchDirectory(path.dirname(normalizedPath));
    this.notifyChange();
  }

  readdirSync(dirPath: string): string[] {
    const normalizedPath = normalizeVmPath(dirPath);
    this.assertDirectory(normalizedPath);

    const childNames = new Set<string>();
    for (const directoryPath of this.directories.keys()) {
      if (directoryPath === normalizedPath) {
        continue;
      }

      const relativePath = path.relative(normalizedPath, directoryPath);
      if (relativePath.length === 0 || relativePath.startsWith("..")) {
        continue;
      }

      const nextSegment = relativePath.split("/")[0];
      if (nextSegment) {
        childNames.add(nextSegment);
      }
    }

    for (const filePath of this.files.keys()) {
      const relativePath = path.relative(normalizedPath, filePath);
      if (relativePath.length === 0 || relativePath.startsWith("..")) {
        continue;
      }

      const nextSegment = relativePath.split("/")[0];
      if (nextSegment) {
        childNames.add(nextSegment);
      }
    }

    return [...childNames].sort((left, right) => left.localeCompare(right));
  }

  writeFileSync(
    filePath: string,
    data: string | ArrayBufferView | ArrayBuffer,
  ): void {
    const normalizedPath = normalizeVmPath(filePath);
    if (this.directories.has(normalizedPath)) {
      throw createFsError("EISDIR", `Cannot write to directory: ${filePath}`);
    }

    this.assertDirectory(path.dirname(normalizedPath));
    this.files.set(normalizedPath, {
      data: toUint8Array(data),
      mtimeMs: Date.now(),
    });
    this.touchDirectory(path.dirname(normalizedPath));
    this.notifyChange();
  }

  readFileSync(
    filePath: string,
    options?: BufferEncoding | { encoding?: BufferEncoding | null } | null,
  ): string | Buffer {
    const normalizedPath = normalizeVmPath(filePath);
    const file = this.files.get(normalizedPath);
    if (!file) {
      if (this.directories.has(normalizedPath)) {
        throw createFsError("EISDIR", `Cannot read directory as file: ${filePath}`);
      }

      throw createFsError("ENOENT", `No such file: ${filePath}`);
    }

    const content = Buffer.from(file.data);
    const encoding = readEncoding(options);
    return encoding ? content.toString(encoding) : content;
  }

  unlinkSync(filePath: string): void {
    const normalizedPath = normalizeVmPath(filePath);
    if (!this.files.delete(normalizedPath)) {
      if (this.directories.has(normalizedPath)) {
        throw createFsError("EISDIR", `Path is a directory: ${filePath}`);
      }

      throw createFsError("ENOENT", `No such file: ${filePath}`);
    }

    this.touchDirectory(path.dirname(normalizedPath));
    this.notifyChange();
  }

  rmSync(
    targetPath: string,
    options: { force?: boolean; recursive?: boolean } = {},
  ): void {
    const normalizedPath = normalizeVmPath(targetPath);
    if (this.files.has(normalizedPath)) {
      this.files.delete(normalizedPath);
      this.touchDirectory(path.dirname(normalizedPath));
      this.notifyChange();
      return;
    }

    if (!this.directories.has(normalizedPath)) {
      if (options.force) {
        return;
      }

      throw createFsError("ENOENT", `No such file or directory: ${targetPath}`);
    }

    if (normalizedPath === "/") {
      throw createFsError("EPERM", "Cannot remove the virtual filesystem root.");
    }

    const childEntries = [
      ...this.files.keys().filter((filePath) => path.dirname(filePath).startsWith(normalizedPath)),
      ...this.directories.keys().filter((directoryPath) => directoryPath.startsWith(`${normalizedPath}/`)),
    ];
    if (childEntries.length > 0 && !options.recursive) {
      throw createFsError("ENOTEMPTY", `Directory is not empty: ${targetPath}`);
    }

    for (const filePath of [...this.files.keys()]) {
      if (filePath === normalizedPath || filePath.startsWith(`${normalizedPath}/`)) {
        this.files.delete(filePath);
      }
    }

    for (const directoryPath of [...this.directories.keys()].sort((left, right) => right.length - left.length)) {
      if (directoryPath === normalizedPath || directoryPath.startsWith(`${normalizedPath}/`)) {
        this.directories.delete(directoryPath);
      }
    }

    this.touchDirectory(path.dirname(normalizedPath));
    this.notifyChange();
  }

  private assertDirectory(dirPath: string): void {
    if (this.files.has(dirPath)) {
      throw createFsError("ENOTDIR", `Path is not a directory: ${dirPath}`);
    }

    if (!this.directories.has(dirPath)) {
      throw createFsError("ENOENT", `No such directory: ${dirPath}`);
    }
  }

  private touchDirectory(dirPath: string): void {
    const normalizedPath = normalizeVmPath(dirPath);
    const directory = this.directories.get(normalizedPath);
    if (!directory) {
      return;
    }

    directory.mtimeMs = Date.now();
  }

  private notifyChange(): void {
    this.options.onChange?.();
  }
}