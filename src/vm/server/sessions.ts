import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, posix as path } from "node:path";
import {
  type ModuleRuntime,
  loadRecoverableVmSnapshot,
  saveRecoverableVmSnapshot,
  resolveRecoverableVmSnapshotFilePath,
} from "../../modules";
import {
  ensureStorageKit,
  executeSql,
  getSqlNotebookCompletionItems,
  readSchemaSnapshot,
} from "../../modules/sql/console";
import { generateVmCode } from "../../primitives";
import {
  createIsbSnapshotTemplatePath,
  createEmptyIsbFile,
  deleteIsbFile,
  moveIsbFile,
  normalizeIsbRelativePath,
  readIsbFile,
  rebaseRecoverableVmSnapshot,
  resolveIsbFilePath,
  writeIsbFile,
  type IsbFile,
  type IsbNotebookDocument,
} from "../isb";
import { VmServerHttpError, buildErrorMessage } from "./http";
import { buildSqlNotebookOutput } from "./sql-output";
import { createSnapshotPath } from "./utils";
import type { OutputEntity } from "../../primitives";
import type { VmCellLanguage, VmServerSession } from "./types";

const MAX_VM_CODE_GENERATION_ATTEMPTS = 64;

export class VmServerSessions {
  private readonly sessions = new Map<string, VmServerSession>();
  private readonly sessionLoads = new Map<string, Promise<VmServerSession>>();
  private readonly sessionCodesByPath = new Map<string, string>();

  constructor(private readonly runtime: ModuleRuntime<any>) {}

  async createNewSession(): Promise<{ session: VmServerSession; created: true }> {
    const code = this.allocateUniqueCode();
    const session = await this.instantiateSession(code, { persistEmptySnapshot: true });
    return {
      session,
      created: true,
    };
  }

  async initializeExistingSession(code: string): Promise<{ session: VmServerSession; created: false }> {
    const session = await this.getOrLoadSession(code);
    return {
      session,
      created: false,
    };
  }

  async createFileSession(relativePath: string): Promise<{ session: VmServerSession; created: true }> {
    const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
    const existingSession = this.getSessionByPath(normalizedRelativePath);
    if (existingSession || existsSync(resolveIsbFilePath(normalizedRelativePath).filePath)) {
      throw new VmServerHttpError(409, `ISB file already exists: ${normalizedRelativePath}`);
    }

    const isbFile = createEmptyIsbFile(normalizedRelativePath);
    await writeIsbFile(isbFile);

    const session = await this.instantiateFileSession(isbFile);
    return {
      session,
      created: true,
    };
  }

  async openFileSession(relativePath: string): Promise<{ session: VmServerSession; created: false }> {
    const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
    const existingSession = this.getSessionByPath(normalizedRelativePath);
    if (existingSession) {
      return {
        session: existingSession,
        created: false,
      };
    }

    let isbFile: IsbFile;
    try {
      isbFile = await readIsbFile(normalizedRelativePath);
    } catch (error) {
      throw new VmServerHttpError(404, buildErrorMessage(error), error);
    }

    const session = await this.instantiateFileSession(isbFile);
    return {
      session,
      created: false,
    };
  }

  async deleteFile(relativePath: string): Promise<{ path: string }> {
    const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
    if (!existsSync(resolveIsbFilePath(normalizedRelativePath).filePath)) {
      throw new VmServerHttpError(404, `ISB file not found: ${normalizedRelativePath}`);
    }

    const existingSession = this.getSessionByPath(normalizedRelativePath);
    if (existingSession) {
      await this.runExclusive(existingSession, async () => {
        await deleteIsbFile(normalizedRelativePath);
        await this.disposeSession(existingSession);
      });
    } else {
      await deleteIsbFile(normalizedRelativePath);
    }

    return { path: normalizedRelativePath };
  }

  async moveFile(relativePath: string, targetPath: string): Promise<{ path: string; targetPath: string }> {
    const normalizedRelativePath = normalizeIsbRelativePath(relativePath);
    const normalizedTargetPath = normalizeIsbRelativePath(targetPath);
    if (normalizedRelativePath === normalizedTargetPath) {
      throw new VmServerHttpError(400, "Move target must differ from the current notebook path.");
    }

    if (!existsSync(resolveIsbFilePath(normalizedRelativePath).filePath)) {
      throw new VmServerHttpError(404, `ISB file not found: ${normalizedRelativePath}`);
    }

    if (
      existsSync(resolveIsbFilePath(normalizedTargetPath).filePath)
      || this.getSessionByPath(normalizedTargetPath)
    ) {
      throw new VmServerHttpError(409, `ISB file already exists: ${normalizedTargetPath}`);
    }

    const existingSession = this.getSessionByPath(normalizedRelativePath);
    if (existingSession) {
      await this.runExclusive(existingSession, async () => {
        const movedFile = await moveIsbFile(normalizedRelativePath, normalizedTargetPath);
        this.rebindSessionPath(existingSession, movedFile.relativePath, movedFile.notebook);
      });
    } else {
      await moveIsbFile(normalizedRelativePath, normalizedTargetPath);
    }

    return {
      path: normalizedRelativePath,
      targetPath: normalizedTargetPath,
    };
  }

  private async getNotebookStorageKit() {
    return await ensureStorageKit({
      getStorageKit: () => this.runtime.getStorageKit(),
      runtime: this.runtime,
    });
  }

  private async evaluateSqlCell(input: string): Promise<OutputEntity[]> {
    const query = input.trim();
    if (query.length === 0) {
      throw new VmServerHttpError(400, "SQL cell cannot be empty.");
    }

    const storageKit = await this.getNotebookStorageKit();
    return buildSqlNotebookOutput(await executeSql(storageKit, query));
  }

  private async evaluateWithLanguage(code: string, input: string, language: VmCellLanguage): Promise<unknown> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const result = language === "sql"
        ? await this.evaluateSqlCell(input)
        : await session.vm.eval(input);
      await this.persistBoundFileSession(session);
      return result;
    });
  }

  async evaluate(code: string, input: string, language: VmCellLanguage = "javascript"): Promise<unknown> {
    return await this.evaluateWithLanguage(code, input, language);
  }

  async getNotebookCompletions(
    code: string,
    fragment: string,
    language: VmCellLanguage = "javascript",
  ): Promise<ReturnType<ModuleRuntime<any>["getNotebookCompletionItems"]>> {
    await this.getOrLoadSession(code);

    if (language === "sql") {
      const storageKit = await this.getNotebookStorageKit();
      const schema = await readSchemaSnapshot(storageKit);
      return getSqlNotebookCompletionItems(fragment, schema);
    }

    return this.runtime.getNotebookCompletionItems(fragment);
  }

  async saveFileSession(code: string, notebook: IsbNotebookDocument): Promise<VmServerSession> {
    const session = await this.getOrLoadSession(code);
    if (!session.relativePath) {
      throw new VmServerHttpError(400, `VM code ${code} is not bound to an ISB file.`);
    }

    await this.runExclusive(session, async () => {
      await this.persistBoundFileSession(session, { notebook });
    });

    return session;
  }

  async restartFileSession(code: string): Promise<VmServerSession> {
    const session = await this.getOrLoadSession(code);
    if (!session.relativePath) {
      throw new VmServerHttpError(400, `VM code ${code} is not bound to an ISB file.`);
    }

    await this.runExclusive(session, async () => {
      const isbFile = await this.readBoundIsbFile(session);
      await this.hydrateFileSession(session, isbFile, {
        notebook: session.notebook ?? isbFile.notebook,
        replaySnapshot: true,
      });
    });

    return session;
  }

  async reloadFileSession(code: string): Promise<VmServerSession> {
    const session = await this.getOrLoadSession(code);
    if (!session.relativePath) {
      throw new VmServerHttpError(400, `VM code ${code} is not bound to an ISB file.`);
    }

    await this.runExclusive(session, async () => {
      const isbFile = await this.readBoundIsbFile(session);
      await this.hydrateFileSession(session, isbFile, {
        notebook: isbFile.notebook,
        replaySnapshot: false,
      });
    });

    return session;
  }

  async listFsDirectory(code: string, dirPath: string): Promise<{
    path: string;
    entries: Array<{
      name: string;
      path: string;
      kind: "file" | "directory";
      size: number;
      mtimeMs: number;
    }>;
  }> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const normalizedPath = this.normalizeFsPath(session, dirPath);

      try {
        const entries = session.vm.fs.readdirSync(normalizedPath)
          .map((name) => {
            const childPath = normalizedPath === "/" ? `/${name}` : `${normalizedPath}/${name}`;
            const stats = session.vm.fs.statSync(childPath);
            return {
              name,
              path: childPath,
              kind: stats.isDirectory() ? "directory" : "file",
              size: stats.size,
              mtimeMs: stats.mtimeMs,
            };
          })
          .sort((left, right) => {
            if (left.kind !== right.kind) {
              return left.kind === "directory" ? -1 : 1;
            }

            return left.name.localeCompare(right.name);
          });

        return {
          path: normalizedPath,
          entries,
        };
      } catch (error) {
        this.throwFsHttpError(error);
      }
    });
  }

  async readFsFile(code: string, filePath: string): Promise<{
    path: string;
    name: string;
    size: number;
    mtimeMs: number;
    isText: boolean;
    content?: string;
    contentBase64?: string;
  }> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const normalizedPath = this.normalizeFsPath(session, filePath);

      try {
        const stats = session.vm.fs.statSync(normalizedPath);
        if (!stats.isFile()) {
          throw Object.assign(new Error(`Path is not a file: ${normalizedPath}`), { code: "EISDIR" });
        }

        const buffer = session.vm.fs.readFileSync(normalizedPath) as Buffer;
        try {
          const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
          return {
            path: normalizedPath,
            name: basename(normalizedPath),
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            isText: true,
            content,
          };
        } catch {
          return {
            path: normalizedPath,
            name: basename(normalizedPath),
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            isText: false,
            contentBase64: buffer.toString("base64"),
          };
        }
      } catch (error) {
        this.throwFsHttpError(error);
      }
    });
  }

  async writeFsFile(
    code: string,
    filePath: string,
    options: { content?: string; contentBase64?: string },
  ): Promise<{
    path: string;
    size: number;
    mtimeMs: number;
  }> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const normalizedPath = this.normalizeFsPath(session, filePath);
      const parentPath = path.dirname(normalizedPath);

      try {
        if (!session.vm.fs.existsSync(parentPath)) {
          session.vm.fs.mkdirSync(parentPath, { recursive: true });
        }

        const data = options.contentBase64 !== undefined
          ? Buffer.from(options.contentBase64, "base64")
          : options.content ?? "";
        session.vm.fs.writeFileSync(normalizedPath, data);
        await this.persistBoundFileSession(session);
        const stats = session.vm.fs.statSync(normalizedPath);
        return {
          path: normalizedPath,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        };
      } catch (error) {
        this.throwFsHttpError(error);
      }
    });
  }

  async mkdirFsDirectory(code: string, dirPath: string): Promise<{ path: string }> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const normalizedPath = this.normalizeFsPath(session, dirPath);

      try {
        session.vm.fs.mkdirSync(normalizedPath, { recursive: true });
        await this.persistBoundFileSession(session);
        return { path: normalizedPath };
      } catch (error) {
        this.throwFsHttpError(error);
      }
    });
  }

  async deleteFsEntry(
    code: string,
    targetPath: string,
    options: { recursive?: boolean } = {},
  ): Promise<{ path: string }> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const normalizedPath = this.normalizeFsPath(session, targetPath);

      try {
        session.vm.fs.rmSync(normalizedPath, {
          recursive: options.recursive ?? true,
          force: false,
        });
        await this.persistBoundFileSession(session);
        return { path: normalizedPath };
      } catch (error) {
        this.throwFsHttpError(error);
      }
    });
  }

  async downloadFsFile(code: string, filePath: string): Promise<{
    path: string;
    name: string;
    buffer: Buffer;
  }> {
    const session = await this.getOrLoadSession(code);
    return await this.runExclusive(session, async () => {
      const normalizedPath = this.normalizeFsPath(session, filePath);

      try {
        const stats = session.vm.fs.statSync(normalizedPath);
        if (!stats.isFile()) {
          throw Object.assign(new Error(`Path is not a file: ${normalizedPath}`), { code: "EISDIR" });
        }

        const buffer = session.vm.fs.readFileSync(normalizedPath) as Buffer;
        return {
          path: normalizedPath,
          name: basename(normalizedPath),
          buffer,
        };
      } catch (error) {
        this.throwFsHttpError(error);
      }
    });
  }

  private allocateUniqueCode(): string {
    for (let attempt = 0; attempt < MAX_VM_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const code = generateVmCode();
      if (this.sessions.has(code) || this.snapshotExists(code)) {
        continue;
      }

      return code;
    }

    throw new VmServerHttpError(500, "Failed to allocate a unique VM code.");
  }

  private async instantiateSession(
    code: string,
    options: { persistEmptySnapshot?: boolean } = {},
  ): Promise<VmServerSession> {
    const vm = this.runtime.createRecoverableVm(createSnapshotPath(code));
    await vm.prepare();
    if (options.persistEmptySnapshot) {
      await vm.save();
    }

    const session: VmServerSession = {
      code,
      vm,
      queue: Promise.resolve(),
    };
    this.registerSession(session);
    return session;
  }

  private async instantiateFileSession(isbFile: IsbFile): Promise<VmServerSession> {
    const existingSession = this.getSessionByPath(isbFile.relativePath);
    if (existingSession) {
      return existingSession;
    }

    const code = this.allocateUniqueCode();
    const snapshotPath = createSnapshotPath(code);
    await saveRecoverableVmSnapshot(
      rebaseRecoverableVmSnapshot(isbFile.snapshot, snapshotPath),
    );

    const vm = this.runtime.createRecoverableVm(snapshotPath);
    await vm.prepare({ replaySnapshot: false });
    const session: VmServerSession = {
      code,
      relativePath: isbFile.relativePath,
      notebook: isbFile.notebook,
      vm,
      queue: Promise.resolve(),
    };
    this.registerSession(session);
    return session;
  }

  private async persistBoundFileSession(
    session: VmServerSession,
    options: { notebook?: IsbNotebookDocument } = {},
  ): Promise<void> {
    if (!session.relativePath) {
      return;
    }

    const currentFile = await this.readBoundIsbFile(session);
    const currentSnapshot = await loadRecoverableVmSnapshot(session.vm.getSnapshotPath());
    const persistedSnapshot = rebaseRecoverableVmSnapshot(
      currentSnapshot,
      createIsbSnapshotTemplatePath(session.relativePath),
    );
    const notebook = options.notebook ?? session.notebook ?? currentFile.notebook;

    await writeIsbFile({
      ...currentFile,
      notebook,
      snapshot: persistedSnapshot,
      savedAt: Date.now(),
    });
    session.notebook = notebook;
  }

  private async readBoundIsbFile(session: VmServerSession): Promise<IsbFile> {
    if (!session.relativePath) {
      throw new VmServerHttpError(400, `VM code ${session.code} is not bound to an ISB file.`);
    }

    try {
      return await readIsbFile(session.relativePath);
    } catch (error) {
      throw new VmServerHttpError(404, buildErrorMessage(error), error);
    }
  }

  private async hydrateFileSession(
    session: VmServerSession,
    isbFile: IsbFile,
    options: { notebook: IsbNotebookDocument; replaySnapshot?: boolean },
  ): Promise<void> {
    const snapshotPath = createSnapshotPath(session.code);
    await saveRecoverableVmSnapshot(
      rebaseRecoverableVmSnapshot(isbFile.snapshot, snapshotPath),
    );

    const vm = this.runtime.createRecoverableVm(snapshotPath);
    await vm.prepare({ replaySnapshot: options.replaySnapshot ?? true });
    session.vm = vm;
    session.notebook = options.notebook;
  }

  private normalizeFsPath(session: VmServerSession, rawPath: string): string {
    if (typeof rawPath !== "string") {
      throw new VmServerHttpError(400, "Filesystem path must be a string.");
    }

    try {
      return session.vm.fs.normalizePath(rawPath);
    } catch (error) {
      throw new VmServerHttpError(400, buildErrorMessage(error), error);
    }
  }

  private throwFsHttpError(error: unknown): never {
    const fsCode = error instanceof Error && "code" in error
      ? String(error.code)
      : null;
    if (fsCode === "ENOENT") {
      throw new VmServerHttpError(404, buildErrorMessage(error), error);
    }

    if (fsCode === "EEXIST" || fsCode === "ENOTEMPTY") {
      throw new VmServerHttpError(409, buildErrorMessage(error), error);
    }

    throw new VmServerHttpError(400, buildErrorMessage(error), error);
  }

  private async disposeSession(session: VmServerSession): Promise<void> {
    this.sessions.delete(session.code);
    if (session.relativePath) {
      this.sessionCodesByPath.delete(session.relativePath);
    }

    await rm(session.vm.getSnapshotFilePath(), { force: true }).catch(() => undefined);
  }

  private rebindSessionPath(
    session: VmServerSession,
    nextRelativePath: string,
    notebook: IsbNotebookDocument,
  ): void {
    if (session.relativePath) {
      this.sessionCodesByPath.delete(session.relativePath);
    }

    session.relativePath = nextRelativePath;
    session.notebook = notebook;
    this.sessionCodesByPath.set(nextRelativePath, session.code);
  }

  private registerSession(session: VmServerSession): void {
    this.sessions.set(session.code, session);
    if (session.relativePath) {
      this.sessionCodesByPath.set(session.relativePath, session.code);
    }
  }

  private getSessionByPath(relativePath: string): VmServerSession | null {
    const code = this.sessionCodesByPath.get(relativePath);
    if (!code) {
      return null;
    }

    return this.sessions.get(code) ?? null;
  }

  private async getOrLoadSession(code: string): Promise<VmServerSession> {
    const existingSession = this.sessions.get(code);
    if (existingSession) {
      return existingSession;
    }

    const existingLoad = this.sessionLoads.get(code);
    if (existingLoad) {
      return await existingLoad;
    }

    if (!this.snapshotExists(code)) {
      throw new VmServerHttpError(404, `Unknown VM code: ${code}`);
    }

    const nextLoad = this.instantiateSession(code)
      .finally(() => {
        this.sessionLoads.delete(code);
      });
    this.sessionLoads.set(code, nextLoad);

    return await nextLoad;
  }

  private snapshotExists(code: string): boolean {
    return existsSync(resolveRecoverableVmSnapshotFilePath(createSnapshotPath(code)).filePath);
  }

  private async runExclusive<T>(session: VmServerSession, action: () => Promise<T>): Promise<T> {
    const nextRun = session.queue
      .catch(() => undefined)
      .then(async () => await action());
    session.queue = nextRun.then(
      () => undefined,
      () => undefined,
    );
    return await nextRun;
  }
}
