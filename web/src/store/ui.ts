import { create } from "zustand";
import {
  createRemotePackageBox,
  createRemoteIsbFile,
  createRemoteVmFsDirectory,
  deleteRemotePackageBox,
  deleteRemoteIsbFile,
  deleteRemoteVmFsEntry,
  downloadRemoteVmFsFile,
  evaluateRemoteCell,
  listRemoteIsbFiles,
  listRemoteVmFs,
  moveRemoteIsbFile,
  openRemoteIsbFile,
  readRemoteVmFsFile,
  reloadRemoteNotebook,
  restartRemoteNotebook,
  saveRemoteNotebook,
  selectRemotePackageBox,
  setRemotePackageBoxPrivilege,
  installRemotePackageSet,
  listRemotePackages,
  writeRemoteVmFsFile,
  listRemoteCloakBrowsers,
  launchRemoteCloakBrowser,
  stopRemoteCloakBrowser,
  navigateRemoteCloakBrowser,
  type RemoteBrowserProfileEntry,
  type RemoteFsEntry,
  type RemoteIsbFileEntry,
  type RemotePackageBoxEntry,
  type RemotePackageHostInfo,
  type RemotePackagePrivilegeLevel,
  type RemotePackageSandboxPolicyExtensions,
  type RemoteSupportedPackageEntry,
  type RemoteNotebookCellLanguage,
  type RemoteNotebookSession,
  type RemoteNotebookCompletionItem,
} from "../api/client";
import { getDefaultNotebook, type NotebookDocument, type NotebookCell } from "../data";

export type InterfaceMode = "obsidian" | "graphite" | "terminal";
export type KernelStatus = "idle" | "running" | "stopped";
export type ServerStatus = "connecting" | "ready" | "error";

function omitRecordKeys<T>(record: Record<string, T>, keys: readonly string[]): Record<string, T> {
  if (keys.length === 0) {
    return record;
  }

  const nextRecord = { ...record };
  for (const key of keys) {
    delete nextRecord[key];
  }

  return nextRecord;
}

function formatCellResult(result: unknown): string[] {
  if (result === undefined || result === null) {
    return [];
  }

  if (typeof result === "string") {
    return [result];
  }

  if (typeof result === "number" || typeof result === "boolean" || typeof result === "bigint") {
    return [String(result)];
  }

  try {
    return [JSON.stringify(result, null, 2)];
  } catch {
    return [String(result)];
  }
}

function createCellId(): string {
  return `cell-${crypto.randomUUID()}`;
}

function createNotebookCell(kind: NotebookCell["kind"]): NotebookCell {
  return {
    id: createCellId(),
    kind,
    title: kind === "markdown"
      ? "New Text"
      : kind === "sql"
        ? "New Query"
        : "New Code",
    source: [""],
    language: kind === "markdown"
      ? undefined
      : kind === "sql"
        ? "sql"
        : "javascript",
  };
}

function isExecutableNotebookCell(cell: NotebookCell | undefined): cell is NotebookCell & { kind: "code" | "sql" } {
  return Boolean(cell && cell.kind !== "markdown");
}

function getNotebookCellLanguage(cell: NotebookCell): RemoteNotebookCellLanguage {
  return cell.kind === "sql" || cell.language === "sql"
    ? "sql"
    : "javascript";
}

function createUntitledNotebookPath(existingPaths: readonly string[]): string {
  const takenPaths = new Set(existingPaths);
  let index = 1;
  while (true) {
    const candidate = index === 1
      ? "workspace/notebook.isb"
      : `workspace/notebook-${index}.isb`;
    if (!takenPaths.has(candidate)) {
      return candidate;
    }

    index += 1;
  }
}

function normalizeNotebookFileName(value: string): string {
  const trimmedValue = value.trim().replace(/\\/gu, "/");
  const rawName = trimmedValue.split("/").filter(Boolean).at(-1) ?? "";
  if (rawName.length === 0) {
    return "";
  }

  return rawName.toLowerCase().endsWith(".isb") ? rawName : `${rawName}.isb`;
}

function getNotebookDirectoryPath(relativePath: string): string {
  const segments = relativePath.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

function joinNotebookPath(directoryPath: string, fileName: string): string {
  const normalizedFileName = normalizeNotebookFileName(fileName);
  if (normalizedFileName.length === 0) {
    return directoryPath;
  }

  return directoryPath.length > 0
    ? `${directoryPath}/${normalizedFileName}`
    : normalizedFileName;
}

function createUntitledNotebookPathInDirectory(
  existingPaths: readonly string[],
  directoryPath: string,
): string {
  const takenPaths = new Set(existingPaths);
  let index = 1;
  while (true) {
    const candidate = joinNotebookPath(
      directoryPath,
      index === 1 ? "notebook.isb" : `notebook-${index}.isb`,
    );
    if (!takenPaths.has(candidate)) {
      return candidate;
    }

    index += 1;
  }
}

function getNotebookFolderNodeIds(relativePath: string): string[] {
  const segments = getNotebookDirectoryPath(relativePath).split("/").filter(Boolean);
  const nodeIds: string[] = [];
  let currentPath = "";
  for (const segment of segments) {
    currentPath = currentPath.length > 0 ? `${currentPath}/${segment}` : segment;
    nodeIds.push(`folder:${currentPath}`);
  }

  return nodeIds;
}

function getNotebookExecutionCounts(notebook: NotebookDocument): Record<string, number> {
  return Object.fromEntries(
    notebook.cells
      .filter((cell) => typeof cell.executionCount === "number")
      .map((cell) => [cell.id, cell.executionCount as number]),
  );
}

function areStringArraysEqual(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === right) {
    return true;
  }

  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function canReuseCellResult(previousCell: NotebookCell | undefined, nextCell: NotebookCell): boolean {
  if (!previousCell) {
    return false;
  }

  return previousCell.kind === nextCell.kind
    && previousCell.title === nextCell.title
    && previousCell.language === nextCell.language
    && (previousCell.executionCount ?? null) === (nextCell.executionCount ?? null)
    && areStringArraysEqual(previousCell.source, nextCell.source)
    && areStringArraysEqual(previousCell.output, nextCell.output);
}

function parentVmPath(targetPath: string): string {
  if (targetPath === "/") {
    return "/";
  }

  const segments = targetPath.split("/").filter(Boolean);
  segments.pop();
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function joinVmPath(directoryPath: string, name: string): string {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return directoryPath;
  }

  if (trimmedName.startsWith("/")) {
    return trimmedName;
  }

  return directoryPath === "/" ? `/${trimmedName}` : `${directoryPath}/${trimmedName}`;
}

function encodeArrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function confirmDiscardNotebookChanges(relativePath: string): boolean {
  if (typeof globalThis.confirm !== "function") {
    return true;
  }

  return globalThis.confirm(
    `Unsaved notebook changes in ${relativePath} will be lost. Discard changes and switch?`,
  );
}

function confirmDeleteNotebook(relativePath: string, options: { hasUnsavedChanges?: boolean } = {}): boolean {
  if (typeof globalThis.confirm !== "function") {
    return true;
  }

  const warningPrefix = options.hasUnsavedChanges
    ? `Unsaved notebook changes in ${relativePath} will be lost.\n\n`
    : "";

  return globalThis.confirm(
    `${warningPrefix}Delete notebook ${relativePath}? This cannot be undone.`,
  );
}

export type PackageBoxModalTab = "overview" | "presets" | "packages" | "terminal" | "policy";

export type ModalType = "file-editor" | "file-preview" | "package-box" | "browser-profile" | null;

export type ContextMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  tone?: "default" | "accent" | "danger";
  onSelect: () => void | Promise<void>;
};

export type ContextMenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
};

type InterfaceState = {
  activeMode: InterfaceMode;
  signalBloom: boolean;
  hasBootstrapped: boolean;
  serverStatus: ServerStatus;
  isLoadingFiles: boolean;
  isOpeningFile: boolean;
  isSaving: boolean;
  isFsLoading: boolean;
  isFsSaving: boolean;
  selectedFileId: string;
  activeCellId: string;
  executionCounts: Record<string, number>;
  cellResults: Record<string, unknown>;
  runningCellIds: Record<string, boolean>;
  expandedFolderIds: string[];
  kernelStatus: KernelStatus;
  lastRunLabel: string;
  isbFiles: RemoteIsbFileEntry[];
  notebooks: Record<string, NotebookDocument>;
  notebookDirtyByFile: Record<string, boolean>;
  sessionCodeByFile: Record<string, string>;
  snapshotPathByFile: Record<string, string>;
  currentFsPath: string;
  fsEntries: RemoteFsEntry[];
  selectedFsPath: string;
  selectedFsIsText: boolean;
  selectedFsContent: string;
  selectedFsContentBase64: string;
  selectedFsSize: number;
  fsDraftContent: string;
  isFsDirty: boolean;
  rightPanelTab: "files" | "browsers" | "packages";
  browserProfiles: RemoteBrowserProfileEntry[];
  isBrowserLoading: boolean;
  browserActionTarget: string | null;
  browserActionKind: "launch" | "stop" | "navigate" | null;
  packageBoxes: RemotePackageBoxEntry[];
  supportedPackages: RemoteSupportedPackageEntry[];
  defaultPackageBoxId: string | null;
  packageHostInfo: RemotePackageHostInfo | null;
  isPackagesLoading: boolean;
  packageActionTarget: string | null;
  packageActionKind: "create" | "select" | "install" | "privilege" | "delete" | null;
  activeModal: ModalType;
  activeBrowserProfileId: string | null;
  activePackageBoxId: string | null;
  activePackageBoxTab: PackageBoxModalTab;
  contextMenu: ContextMenuState | null;
  tooltip: string | null;
  completionCache: Record<string, { fragment: string; items: RemoteNotebookCompletionItem[] }>;
  bootstrap: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  openRemoteFile: (relativePath: string) => Promise<void>;
  switchRemoteFile: (relativePath: string) => Promise<void>;
  createRemoteFile: (relativePath?: string) => Promise<void>;
  createNotebookInFolder: (directoryPath: string, notebookName?: string) => Promise<void>;
  renameNotebook: (relativePath: string, nextName: string) => Promise<void>;
  moveNotebook: (relativePath: string, targetPath: string) => Promise<void>;
  deleteNotebook: (relativePath: string) => Promise<void>;
  selectRightPanelTab: (tab: "files" | "browsers" | "packages") => Promise<void>;
  refreshBrowserList: () => Promise<void>;
  launchBrowserProfile: (target: string) => Promise<void>;
  stopBrowserProfile: (target: string) => Promise<void>;
  navigateBrowserProfile: (target: string, url: string) => Promise<void>;
  refreshPackageList: () => Promise<void>;
  createPackageBox: (input: { id: string; name?: string; description?: string; packages?: string[]; sandboxPolicyExtensions?: Partial<RemotePackageSandboxPolicyExtensions> }) => Promise<void>;
  deletePackageBox: (target: string) => Promise<void>;
  selectPackageBox: (target: string) => Promise<void>;
  installPackageSet: (packages: string[], target?: string) => Promise<void>;
  setPackageBoxPrivilege: (target: string, input: { defaultPrivilegeLevel?: RemotePackagePrivilegeLevel; allowedPrivilegeLevels?: RemotePackagePrivilegeLevel[]; sandboxPolicyExtensions?: Partial<RemotePackageSandboxPolicyExtensions> }) => Promise<void>;
  openBrowserProfileModal: (profileId: string) => void;
  openPackageBoxModal: (boxId: string, tab?: PackageBoxModalTab) => void;
  setPackageBoxModalTab: (tab: PackageBoxModalTab) => void;
  selectMode: (mode: InterfaceMode) => void;
  toggleSignalBloom: () => void;
  selectFile: (fileId: string, defaultCellId: string) => void;
  focusCell: (cellId: string) => void;
  toggleFolder: (folderId: string) => void;
  runCell: (notebookId: string, cellId: string) => Promise<void>;
  runNotebook: (notebookId: string) => Promise<void>;
  stopExecution: (label: string) => void;
  restartKernel: (notebookId: string) => Promise<void>;
  reloadNotebook: (notebookId: string) => Promise<void>;
  saveNotebook: (notebookId: string) => Promise<void>;
  addCell: (notebookId: string, kind: NotebookCell["kind"]) => void;
  addCellAfter: (notebookId: string, cellId: string, kind: NotebookCell["kind"]) => void;
  deleteCell: (notebookId: string, cellId: string) => void;
  moveCellUp: (notebookId: string, cellId: string) => void;
  moveCellDown: (notebookId: string, cellId: string) => void;
  updateCellSource: (notebookId: string, cellId: string, source: string[]) => void;
  loadNotebook: (notebook: NotebookDocument) => void;
  refreshFsDirectory: (targetPath?: string, isAdditive?: boolean) => Promise<void>;
  openFsFile: (targetPath: string) => Promise<void>;
  updateFsDraft: (content: string) => void;
  saveFsFile: () => Promise<void>;
  createFsFile: (targetPath?: string) => Promise<void>;
  createFsDirectory: (targetPath?: string) => Promise<void>;
  deleteFsEntry: (targetPath: string) => Promise<void>;
  uploadFsFile: (file: File, targetDirectory?: string) => Promise<void>;
  downloadFsFile: (targetPath?: string) => Promise<void>;
  setModal: (type: ModalType) => void;
  closeModal: () => void;
  openContextMenu: (contextMenu: ContextMenuState) => void;
  closeContextMenu: () => void;
  setTooltip: (text: string | null) => void;
  setCompletionCache: (sessionCode: string, fragment: string, items: RemoteNotebookCompletionItem[]) => void;
};

export const useInterfaceStore = create<InterfaceState>((set, get) => {
  const getSessionCode = (notebookId?: string): string | null => {
    const state = get();
    const resolvedNotebookId = notebookId ?? state.selectedFileId;
    if (!resolvedNotebookId) {
      return null;
    }

    return state.sessionCodeByFile[resolvedNotebookId] ?? null;
  };

  const clearFsSelection = (): Pick<
    InterfaceState,
    "selectedFsPath" | "selectedFsIsText" | "selectedFsContent" | "selectedFsContentBase64" | "selectedFsSize" | "fsDraftContent" | "isFsDirty"
  > => ({
    selectedFsPath: "",
    selectedFsIsText: true,
    selectedFsContent: "",
    selectedFsContentBase64: "",
    selectedFsSize: 0,
    fsDraftContent: "",
    isFsDirty: false,
  });

  const removeNotebookState = (
    state: InterfaceState,
    notebookId: string,
    options: { resetSelection?: boolean } = {},
  ): Partial<InterfaceState> => {
    const cellIds = state.notebooks[notebookId]?.cells.map((cell) => cell.id) ?? [];

    return {
      notebooks: omitRecordKeys(state.notebooks, [notebookId]),
      notebookDirtyByFile: omitRecordKeys(state.notebookDirtyByFile, [notebookId]),
      sessionCodeByFile: omitRecordKeys(state.sessionCodeByFile, [notebookId]),
      snapshotPathByFile: omitRecordKeys(state.snapshotPathByFile, [notebookId]),
      executionCounts: omitRecordKeys(state.executionCounts, cellIds),
      cellResults: omitRecordKeys(state.cellResults, cellIds),
      runningCellIds: omitRecordKeys(state.runningCellIds, cellIds),
      ...(options.resetSelection
        ? {
          selectedFileId: "",
          activeCellId: "",
          currentFsPath: "/",
          fsEntries: [],
          ...clearFsSelection(),
        }
        : {}),
    };
  };

  const renameNotebookState = (
    state: InterfaceState,
    sourcePath: string,
    targetPath: string,
  ): Partial<InterfaceState> => {
    const nextNotebooks = { ...state.notebooks };
    const notebook = nextNotebooks[sourcePath];
    delete nextNotebooks[sourcePath];
    if (notebook) {
      nextNotebooks[targetPath] = {
        ...notebook,
        id: targetPath,
        path: targetPath,
      };
    }

    const nextDirty = { ...state.notebookDirtyByFile };
    if (sourcePath in nextDirty) {
      nextDirty[targetPath] = nextDirty[sourcePath] ?? false;
      delete nextDirty[sourcePath];
    }

    const nextSessionCodes = { ...state.sessionCodeByFile };
    if (sourcePath in nextSessionCodes) {
      nextSessionCodes[targetPath] = nextSessionCodes[sourcePath] ?? "";
      delete nextSessionCodes[sourcePath];
    }

    const nextSnapshotPaths = { ...state.snapshotPathByFile };
    if (sourcePath in nextSnapshotPaths) {
      nextSnapshotPaths[targetPath] = nextSnapshotPaths[sourcePath] ?? "";
      delete nextSnapshotPaths[sourcePath];
    }

    return {
      notebooks: nextNotebooks,
      notebookDirtyByFile: nextDirty,
      sessionCodeByFile: nextSessionCodes,
      snapshotPathByFile: nextSnapshotPaths,
      selectedFileId: state.selectedFileId === sourcePath ? targetPath : state.selectedFileId,
    };
  };

  const setSessionState = (
    session: RemoteNotebookSession,
    options: { preserveCellResults?: boolean } = {},
  ): void => {
    set((state) => ({
      ...(function () {
        const previousCells = state.notebooks[session.relativePath]?.cells ?? [];
        const previousCellsById = new Map(previousCells.map((cell) => [cell.id, cell]));
        const nextCellIds = session.notebook.cells.map((cell) => cell.id);
        const removableCellResultIds = options.preserveCellResults
          ? [
            ...previousCells
              .filter((cell) => !nextCellIds.includes(cell.id))
              .map((cell) => cell.id),
            ...session.notebook.cells
              .filter((cell) => !canReuseCellResult(previousCellsById.get(cell.id), cell))
              .map((cell) => cell.id),
          ]
          : [...new Set([
            ...previousCells.map((cell) => cell.id),
            ...nextCellIds,
          ])];

        return {
          cellResults: omitRecordKeys(state.cellResults, [...new Set(removableCellResultIds)]),
        };
      })(),
      serverStatus: "ready",
      kernelStatus: "idle",
      selectedFileId: session.relativePath,
      activeCellId: state.activeCellId && session.notebook.cells.some((cell) => cell.id === state.activeCellId)
        ? state.activeCellId
        : (session.notebook.cells[0]?.id ?? ""),
      runningCellIds: omitRecordKeys(
        state.runningCellIds,
        [...new Set([
          ...(state.notebooks[session.relativePath]?.cells.map((cell) => cell.id) ?? []),
          ...session.notebook.cells.map((cell) => cell.id),
        ])],
      ),
      notebooks: {
        ...state.notebooks,
        [session.relativePath]: session.notebook,
      },
      notebookDirtyByFile: {
        ...state.notebookDirtyByFile,
        [session.relativePath]: false,
      },
      executionCounts: {
        ...state.executionCounts,
        ...getNotebookExecutionCounts(session.notebook),
      },
      sessionCodeByFile: {
        ...state.sessionCodeByFile,
        [session.relativePath]: session.code,
      },
      snapshotPathByFile: {
        ...state.snapshotPathByFile,
        [session.relativePath]: session.snapshotPath,
      },
      lastRunLabel: `${session.relativePath} / ready`,
    }));
  };

  const loadFsDirectory = async (
    sessionCode: string,
    targetPath: string,
    options: { resetSelection?: boolean; isAdditive?: boolean } = {},
  ): Promise<void> => {
    set({ isFsLoading: true });
    try {
      const directory = await listRemoteVmFs(sessionCode, targetPath);
      set((state) => {
        const newEntries = options.isAdditive ? [...state.fsEntries] : [...directory.entries];
        if (options.isAdditive) {
          for (const entry of directory.entries) {
            if (!newEntries.find((existing) => existing.path === entry.path)) {
              newEntries.push(entry);
            }
          }
        }

        return {
          isFsLoading: false,
          currentFsPath: directory.path,
          fsEntries: newEntries,
          ...(options.resetSelection ? clearFsSelection() : {}),
        };
      });
    } catch (error) {
      set({
        isFsLoading: false,
        serverStatus: "error",
        lastRunLabel: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const applyRemoteSession = async (
    session: RemoteNotebookSession,
    options: { resetFsSelection?: boolean } = {},
  ): Promise<void> => {
    setSessionState(session);
    await get().refreshFiles();
    await loadFsDirectory(session.code, "/", { resetSelection: options.resetFsSelection ?? true });
  };

  const loadBrowserProfiles = async (options: { showLoading?: boolean } = {}): Promise<void> => {
    const showLoading = options.showLoading ?? true;
    if (showLoading) {
      set({ isBrowserLoading: true });
    }

    try {
      const browserProfiles = await listRemoteCloakBrowsers();
      set({
        browserProfiles,
        isBrowserLoading: false,
        serverStatus: "ready",
      });
    } catch (error) {
      set({
        isBrowserLoading: false,
        serverStatus: "error",
        lastRunLabel: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const loadPackageSnapshot = async (options: { showLoading?: boolean } = {}): Promise<void> => {
    const showLoading = options.showLoading ?? true;
    if (showLoading) {
      set({ isPackagesLoading: true });
    }

    try {
      const snapshot = await listRemotePackages();
      set({
        packageBoxes: snapshot.boxes,
        supportedPackages: snapshot.supportedPackages,
        defaultPackageBoxId: snapshot.defaultBoxId,
        packageHostInfo: snapshot.hostInfo,
        isPackagesLoading: false,
        serverStatus: "ready",
      });
    } catch (error) {
      set({
        isPackagesLoading: false,
        serverStatus: "error",
        lastRunLabel: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  return {
    activeMode: "obsidian",
    signalBloom: true,
    hasBootstrapped: false,
    serverStatus: "connecting",
    isLoadingFiles: false,
    isOpeningFile: false,
    isSaving: false,
    isFsLoading: false,
    isFsSaving: false,
    selectedFileId: "",
    activeCellId: "",
    executionCounts: {},
    cellResults: {},
    runningCellIds: {},
    expandedFolderIds: ["folder:workspace"],
    kernelStatus: "idle",
    lastRunLabel: "Connecting to VM server",
    isbFiles: [],
    notebooks: {},
    notebookDirtyByFile: {},
    sessionCodeByFile: {},
    snapshotPathByFile: {},
    currentFsPath: "/",
    fsEntries: [],
    rightPanelTab: "files",
    browserProfiles: [],
    isBrowserLoading: false,
    browserActionTarget: null,
    browserActionKind: null,
    packageBoxes: [],
    supportedPackages: [],
    defaultPackageBoxId: null,
    packageHostInfo: null,
    isPackagesLoading: false,
    packageActionTarget: null,
    packageActionKind: null,
    ...clearFsSelection(),
    activeModal: null,
    activeBrowserProfileId: null,
    activePackageBoxId: null,
    activePackageBoxTab: "overview",
    contextMenu: null,
    tooltip: null,
    completionCache: {},
    bootstrap: async () => {
      if (get().hasBootstrapped || get().isLoadingFiles) {
        return;
      }

      set({ isLoadingFiles: true, serverStatus: "connecting", lastRunLabel: "Loading workspace files" });
      try {
        const files = await listRemoteIsbFiles();
        set({ isbFiles: files });

        let requestedPath: string | undefined;
        let requestedCellId: string | undefined;
        if (window.location.hash.length > 1) {
          const hashParts = window.location.hash.slice(1).split(":");
          requestedPath = decodeURIComponent(hashParts[0] ?? "");
          requestedCellId = hashParts[1] ? decodeURIComponent(hashParts[1]) : undefined;
        }

        if (files.length === 0) {
          if (requestedPath) {
            await get().createRemoteFile(requestedPath);
            if (requestedCellId) {
              set({ activeCellId: requestedCellId });
            }
          } else {
            await get().createRemoteFile();
          }
        } else {
          const selectedPath = requestedPath || get().selectedFileId || files[0]?.relativePath;
          if (selectedPath) {
            const fileExists = files.some(f => f.relativePath === selectedPath);
            if (!fileExists && requestedPath) {
              await get().createRemoteFile(selectedPath);
            } else {
              await get().openRemoteFile(selectedPath);
            }
            if (requestedCellId) {
              set({ activeCellId: requestedCellId });
            }
          }
        }

        set({ hasBootstrapped: true, isLoadingFiles: false, serverStatus: "ready" });
      } catch (error) {
        set({
          hasBootstrapped: false,
          isLoadingFiles: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    refreshFiles: async () => {
      set({ isLoadingFiles: true });
      try {
        const files = await listRemoteIsbFiles();
        set({ isbFiles: files, isLoadingFiles: false, serverStatus: "ready" });
      } catch (error) {
        set({
          isLoadingFiles: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    selectRightPanelTab: async (tab) => {
      set({ rightPanelTab: tab });
      if (tab === "browsers") {
        await get().refreshBrowserList();
        return;
      }

      if (tab === "packages") {
        await get().refreshPackageList();
      }
    },
    refreshBrowserList: async () => {
      await loadBrowserProfiles({ showLoading: true });
    },
    launchBrowserProfile: async (target) => {
      set({
        browserActionTarget: target,
        browserActionKind: "launch",
        serverStatus: "connecting",
        lastRunLabel: `${target} / launching browser`,
      });
      try {
        await launchRemoteCloakBrowser(target);
        await loadBrowserProfiles({ showLoading: false });
        set({ browserActionTarget: null, browserActionKind: null, serverStatus: "ready" });
      } catch (error) {
        set({
          browserActionTarget: null,
          browserActionKind: null,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    stopBrowserProfile: async (target) => {
      set({
        browserActionTarget: target,
        browserActionKind: "stop",
        serverStatus: "connecting",
        lastRunLabel: `${target} / stopping browser`,
      });
      try {
        await stopRemoteCloakBrowser(target);
        await loadBrowserProfiles({ showLoading: false });
        set({ browserActionTarget: null, browserActionKind: null, serverStatus: "ready" });
      } catch (error) {
        set({
          browserActionTarget: null,
          browserActionKind: null,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    navigateBrowserProfile: async (target, url) => {
      set({
        browserActionTarget: target,
        browserActionKind: "navigate",
        serverStatus: "connecting",
        lastRunLabel: `${target} / navigating browser`,
      });
      try {
        await navigateRemoteCloakBrowser(target, url);
        await loadBrowserProfiles({ showLoading: false });
        set({ browserActionTarget: null, browserActionKind: null, serverStatus: "ready" });
      } catch (error) {
        set({
          browserActionTarget: null,
          browserActionKind: null,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    refreshPackageList: async () => {
      await loadPackageSnapshot({ showLoading: true });
    },
    createPackageBox: async (input) => {
      set({
        packageActionTarget: input.id,
        packageActionKind: "create",
        serverStatus: "connecting",
        lastRunLabel: `${input.id} / creating package box`,
      });
      try {
        await createRemotePackageBox(input);
        await loadPackageSnapshot({ showLoading: false });
        set({ packageActionTarget: null, packageActionKind: null, serverStatus: "ready" });
      } catch (error) {
        set({
          packageActionTarget: null,
          packageActionKind: null,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    deletePackageBox: async (target) => {
      set({
        packageActionTarget: target,
        packageActionKind: "delete",
        serverStatus: "connecting",
        lastRunLabel: `${target} / deleting package box`,
      });
      try {
        await deleteRemotePackageBox(target);
        await loadPackageSnapshot({ showLoading: false });
        set((state) => ({
          packageActionTarget: null,
          packageActionKind: null,
          serverStatus: "ready",
          lastRunLabel: `${target} / deleted`,
          ...(state.activePackageBoxId === target
            ? {
              activeModal: null,
              activePackageBoxId: null,
              activePackageBoxTab: "overview" as const,
            }
            : {}),
        }));
      } catch (error) {
        set({
          packageActionTarget: null,
          packageActionKind: null,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    selectPackageBox: async (target) => {
      set({
        packageActionTarget: target,
        packageActionKind: "select",
        serverStatus: "connecting",
        lastRunLabel: `${target} / selecting package box`,
      });
      try {
        await selectRemotePackageBox(target);
        await loadPackageSnapshot({ showLoading: false });
        set({ packageActionTarget: null, packageActionKind: null, serverStatus: "ready" });
      } catch (error) {
        set({
          packageActionTarget: null,
          packageActionKind: null,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    installPackageSet: async (packages, target) => {
      const labelTarget = target ?? get().defaultPackageBoxId ?? packages[0] ?? "packages";
      set({
        packageActionTarget: labelTarget,
        packageActionKind: "install",
        serverStatus: "connecting",
        lastRunLabel: `${labelTarget} / installing package set`,
      });
      try {
        await installRemotePackageSet(packages, target);
        await loadPackageSnapshot({ showLoading: false });
        set({ packageActionTarget: null, packageActionKind: null, serverStatus: "ready" });
      } catch (error) {
        set({
          packageActionTarget: null,
          packageActionKind: null,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    setPackageBoxPrivilege: async (target, input) => {
      set({
        packageActionTarget: target,
        packageActionKind: "privilege",
        serverStatus: "connecting",
        lastRunLabel: `${target} / updating privilege policy`,
      });
      try {
        await setRemotePackageBoxPrivilege({
          target,
          allowedPrivilegeLevels: input.allowedPrivilegeLevels,
          defaultPrivilegeLevel: input.defaultPrivilegeLevel,
          sandboxPolicyExtensions: input.sandboxPolicyExtensions,
        });
        await loadPackageSnapshot({ showLoading: false });
        set({ packageActionTarget: null, packageActionKind: null, serverStatus: "ready" });
      } catch (error) {
        set({
          packageActionTarget: null,
          packageActionKind: null,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    openPackageBoxModal: (boxId, tab = "overview") => set({
      activeModal: "package-box",
      activePackageBoxId: boxId,
      activePackageBoxTab: tab,
    }),
    openBrowserProfileModal: (profileId) => set({
      activeModal: "browser-profile",
      activeBrowserProfileId: profileId,
    }),
    setPackageBoxModalTab: (tab) => set({ activePackageBoxTab: tab }),
    openRemoteFile: async (relativePath) => {
      set({ isOpeningFile: true, serverStatus: "connecting", lastRunLabel: `${relativePath} / open` });
      try {
        const session = await openRemoteIsbFile(relativePath);
        set({ isOpeningFile: false });
        await applyRemoteSession(session);
      } catch (error) {
        set({
          isOpeningFile: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    switchRemoteFile: async (relativePath) => {
      const state = get();
      if (relativePath === state.selectedFileId) {
        return;
      }

      const selectedNotebookId = state.selectedFileId;
      if (
        selectedNotebookId
        && state.notebookDirtyByFile[selectedNotebookId]
      ) {
        if (!confirmDiscardNotebookChanges(selectedNotebookId)) {
          set({ lastRunLabel: `${selectedNotebookId} / switch cancelled` });
          return;
        }

        set((currentState) => ({
          notebookDirtyByFile: {
            ...currentState.notebookDirtyByFile,
            [selectedNotebookId]: false,
          },
        }));
      }

      await get().openRemoteFile(relativePath);
    },
    createRemoteFile: async (relativePath) => {
      const targetPath = relativePath ?? createUntitledNotebookPath(get().isbFiles.map((file) => file.relativePath));
      set({ isOpeningFile: true, serverStatus: "connecting", lastRunLabel: `${targetPath} / create` });
      try {
        const session = await createRemoteIsbFile(targetPath);
        set({ isOpeningFile: false });
        await applyRemoteSession(session);
      } catch (error) {
        set({
          isOpeningFile: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    createNotebookInFolder: async (directoryPath, notebookName) => {
      const targetPath = notebookName
        ? joinNotebookPath(directoryPath, notebookName)
        : createUntitledNotebookPathInDirectory(
          get().isbFiles.map((file) => file.relativePath),
          directoryPath,
        );
      if (!targetPath.endsWith(".isb")) {
        return;
      }

      set((state) => ({
        expandedFolderIds: [...new Set([...state.expandedFolderIds, ...getNotebookFolderNodeIds(targetPath)])],
      }));
      await get().createRemoteFile(targetPath);
    },
    renameNotebook: async (relativePath, nextName) => {
      const normalizedName = normalizeNotebookFileName(nextName);
      if (!normalizedName) {
        return;
      }

      await get().moveNotebook(relativePath, joinNotebookPath(getNotebookDirectoryPath(relativePath), normalizedName));
    },
    moveNotebook: async (relativePath, targetPath) => {
      const normalizedTargetPath = joinNotebookPath(
        getNotebookDirectoryPath(targetPath),
        targetPath.split("/").filter(Boolean).at(-1) ?? "",
      );
      if (!normalizedTargetPath || normalizedTargetPath === relativePath) {
        return;
      }

      const state = get();
      const isSelectedNotebook = state.selectedFileId === relativePath;
      if (isSelectedNotebook && state.notebookDirtyByFile[relativePath]) {
        await get().saveNotebook(relativePath);
        if (get().notebookDirtyByFile[relativePath]) {
          set({ lastRunLabel: `${relativePath} / move cancelled` });
          return;
        }
      }

      set({ isOpeningFile: true, serverStatus: "connecting", lastRunLabel: `${relativePath} / move` });
      try {
        const moved = await moveRemoteIsbFile(relativePath, normalizedTargetPath);
        set((currentState) => ({
          ...renameNotebookState(currentState, relativePath, moved.targetPath),
          isOpeningFile: false,
          serverStatus: "ready",
          lastRunLabel: `${moved.targetPath} / moved`,
          expandedFolderIds: [
            ...new Set([
              ...currentState.expandedFolderIds,
              ...getNotebookFolderNodeIds(moved.targetPath),
            ]),
          ],
        }));
        await get().refreshFiles();

        if (isSelectedNotebook) {
          const sessionCode = get().sessionCodeByFile[moved.targetPath];
          if (sessionCode) {
            await loadFsDirectory(sessionCode, "/", { resetSelection: true });
          }
        }
      } catch (error) {
        set({
          isOpeningFile: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    deleteNotebook: async (relativePath) => {
      const state = get();
      const isSelectedNotebook = state.selectedFileId === relativePath;
      const hasUnsavedChanges = Boolean(state.notebookDirtyByFile[relativePath]);
      if (!confirmDeleteNotebook(relativePath, { hasUnsavedChanges })) {
        set({ lastRunLabel: `${relativePath} / delete cancelled` });
        return;
      }

      set({ isOpeningFile: true, serverStatus: "connecting", lastRunLabel: `${relativePath} / delete` });
      try {
        await deleteRemoteIsbFile(relativePath);
        set((currentState) => ({
          ...removeNotebookState(currentState, relativePath, { resetSelection: isSelectedNotebook }),
          isOpeningFile: false,
          serverStatus: "ready",
          lastRunLabel: `${relativePath} / deleted`,
        }));
        await get().refreshFiles();

        if (isSelectedNotebook) {
          const fallbackNotebookId = get().isbFiles[0]?.relativePath;
          if (fallbackNotebookId) {
            await get().openRemoteFile(fallbackNotebookId);
          } else {
            await get().createRemoteFile();
          }
        }
      } catch (error) {
        set({
          isOpeningFile: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    selectMode: (mode) => set({ activeMode: mode }),
    toggleSignalBloom: () => set((state) => ({ signalBloom: !state.signalBloom })),
    selectFile: (fileId, defaultCellId) => set({ selectedFileId: fileId, activeCellId: defaultCellId }),
    focusCell: (cellId) => set({ activeCellId: cellId }),
    toggleFolder: (folderId) => set((state) => ({
      expandedFolderIds: state.expandedFolderIds.includes(folderId)
        ? state.expandedFolderIds.filter((id) => id !== folderId)
        : [...state.expandedFolderIds, folderId],
    })),
    runCell: async (notebookId, cellId) => {
      const state = get();
      const notebook = state.notebooks[notebookId] ?? getDefaultNotebook();
      const cell = notebook.cells.find((entry) => entry.id === cellId);
      const sessionCode = getSessionCode(notebookId);
      if (!isExecutableNotebookCell(cell)) {
        return;
      }

      if (!sessionCode) {
        set({ serverStatus: "error", lastRunLabel: `${notebook.path} / missing VM session` });
        return;
      }

      const nextCount = (state.executionCounts[cellId] ?? cell.executionCount ?? 0) + 1;
      set((currentState) => ({
        kernelStatus: "running",
        serverStatus: "ready",
        lastRunLabel: `${notebook.path} / ${cell.title}`,
        runningCellIds: {
          ...currentState.runningCellIds,
          [cellId]: true,
        },
      }));
      try {
        const result = await evaluateRemoteCell(sessionCode, cell.source.join("\n"), {
          language: getNotebookCellLanguage(cell),
        });
        const output = formatCellResult(result);
        set((currentState) => {
          const currentNotebook = currentState.notebooks[notebookId] ?? notebook;
          const nextRunningCellIds = { ...currentState.runningCellIds };
          delete nextRunningCellIds[cellId];

          return {
          executionCounts: {
            ...currentState.executionCounts,
            [cellId]: nextCount,
          },
          cellResults: {
            ...currentState.cellResults,
            [cellId]: result,
          },
          runningCellIds: nextRunningCellIds,
          kernelStatus: "idle",
          lastRunLabel: `${notebook.path} / ${cell.title}`,
          notebooks: {
            ...currentState.notebooks,
            [notebookId]: {
              ...currentNotebook,
              cells: currentNotebook.cells.map((entry) => entry.id === cellId
                ? { ...entry, executionCount: nextCount, output }
                : entry),
            },
          },
        };
      });
      } catch (error) {
        set((currentState) => {
          const currentNotebook = currentState.notebooks[notebookId] ?? notebook;
          const nextRunningCellIds = { ...currentState.runningCellIds };
          delete nextRunningCellIds[cellId];
          const nextCellResults = { ...currentState.cellResults };
          delete nextCellResults[cellId];

          return {
          kernelStatus: "stopped",
          serverStatus: "error",
          runningCellIds: nextRunningCellIds,
          cellResults: nextCellResults,
          lastRunLabel: error instanceof Error ? error.message : String(error),
          notebooks: {
            ...currentState.notebooks,
            [notebookId]: {
              ...currentNotebook,
              cells: currentNotebook.cells.map((entry) => entry.id === cellId
                ? {
                  ...entry,
                  executionCount: nextCount,
                  output: [error instanceof Error ? error.message : String(error)],
                }
                : entry),
            },
          },
        };
      });
      }
    },
    runNotebook: async (notebookId) => {
      const notebook = get().notebooks[notebookId];
      if (!notebook) {
        return;
      }

      set({ kernelStatus: "running", lastRunLabel: `${notebook.path} / run all` });
      for (const cell of notebook.cells) {
        if (!isExecutableNotebookCell(cell)) {
          continue;
        }

        await get().runCell(notebookId, cell.id);
      }
      set({ kernelStatus: "idle", lastRunLabel: `${notebook.path} / run all` });
    },
    stopExecution: (label) => set({ kernelStatus: "stopped", lastRunLabel: label, runningCellIds: {} }),
    restartKernel: async (notebookId) => {
      const state = get();
      const notebook = state.notebooks[notebookId];
      const sessionCode = getSessionCode(notebookId);
      if (!notebook || !sessionCode) {
        set({ serverStatus: "error", lastRunLabel: `${notebookId} / missing restart session` });
        return;
      }

      set({ kernelStatus: "running", serverStatus: "connecting", lastRunLabel: `${notebook.path} / restart kernel` });
      try {
        await saveRemoteNotebook(sessionCode, notebook);
        const session = await restartRemoteNotebook(sessionCode);
        setSessionState(session);
        await loadFsDirectory(session.code, get().currentFsPath || "/", { resetSelection: false });
      } catch (error) {
        set({
          kernelStatus: "stopped",
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    reloadNotebook: async (notebookId) => {
      const notebook = get().notebooks[notebookId] ?? getDefaultNotebook();
      const sessionCode = getSessionCode(notebookId);
      if (!sessionCode) {
        set({ serverStatus: "error", lastRunLabel: `${notebookId} / missing reload session` });
        return;
      }

      set({ kernelStatus: "running", serverStatus: "connecting", lastRunLabel: `${notebook.path} / reload from disk` });
      try {
        const session = await reloadRemoteNotebook(sessionCode);
        setSessionState(session);
        await loadFsDirectory(session.code, "/", { resetSelection: true });
      } catch (error) {
        set({
          kernelStatus: "stopped",
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    saveNotebook: async (notebookId) => {
      const state = get();
      const notebook = state.notebooks[notebookId];
      const sessionCode = getSessionCode(notebookId);
      if (!notebook || !sessionCode) {
        set({ serverStatus: "error", lastRunLabel: `${notebookId} / missing save session` });
        return;
      }

      set({ isSaving: true, serverStatus: "connecting", lastRunLabel: `${notebook.path} / save` });
      try {
        const session = await saveRemoteNotebook(sessionCode, notebook);
        setSessionState(session, { preserveCellResults: true });
        set({ isSaving: false });
        await get().refreshFiles();
      } catch (error) {
        set({
          isSaving: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    addCell: (notebookId: string, kind: NotebookCell["kind"]) => set((state) => {
      const notebook = state.notebooks[notebookId];
      if (!notebook) return state;

      const newCell = createNotebookCell(kind);

      return {
        notebooks: {
          ...state.notebooks,
          [notebookId]: {
            ...notebook,
            cells: [...notebook.cells, newCell],
          },
        },
        notebookDirtyByFile: {
          ...state.notebookDirtyByFile,
          [notebookId]: true,
        },
        activeCellId: newCell.id,
      };
    }),
    addCellAfter: (notebookId: string, cellId: string, kind: NotebookCell["kind"]) => set((state) => {
      const notebook = state.notebooks[notebookId];
      if (!notebook) return state;

      const newCell = createNotebookCell(kind);

      const index = notebook.cells.findIndex((cell) => cell.id === cellId);
      const newCells = [...notebook.cells];
      if (index >= 0) {
        newCells.splice(index + 1, 0, newCell);
      } else {
        newCells.push(newCell);
      }

      return {
        notebooks: {
          ...state.notebooks,
          [notebookId]: {
            ...notebook,
            cells: newCells,
          },
        },
        notebookDirtyByFile: {
          ...state.notebookDirtyByFile,
          [notebookId]: true,
        },
        activeCellId: newCell.id,
      };
    }),
    deleteCell: (notebookId: string, cellId: string) => set((state) => {
      const notebook = state.notebooks[notebookId];
      if (!notebook) return state;

      const nextCellResults = { ...state.cellResults };
      delete nextCellResults[cellId];
      const nextRunningCellIds = { ...state.runningCellIds };
      delete nextRunningCellIds[cellId];

      return {
        cellResults: nextCellResults,
        runningCellIds: nextRunningCellIds,
        notebooks: {
          ...state.notebooks,
          [notebookId]: {
            ...notebook,
            cells: notebook.cells.filter((cell) => cell.id !== cellId),
          },
        },
        notebookDirtyByFile: {
          ...state.notebookDirtyByFile,
          [notebookId]: true,
        },
      };
    }),
    moveCellUp: (notebookId: string, cellId: string) => set((state) => {
      const notebook = state.notebooks[notebookId];
      if (!notebook) return state;

      const index = notebook.cells.findIndex((cell) => cell.id === cellId);
      if (index <= 0) return state;

      const newCells = [...notebook.cells];
      const temp = newCells[index - 1]!;
      newCells[index - 1] = newCells[index]!;
      newCells[index] = temp;

      return {
        notebooks: {
          ...state.notebooks,
          [notebookId]: {
            ...notebook,
            cells: newCells,
          },
        },
        notebookDirtyByFile: {
          ...state.notebookDirtyByFile,
          [notebookId]: true,
        },
      };
    }),
    moveCellDown: (notebookId: string, cellId: string) => set((state) => {
      const notebook = state.notebooks[notebookId];
      if (!notebook) return state;

      const index = notebook.cells.findIndex((cell) => cell.id === cellId);
      if (index === -1 || index >= notebook.cells.length - 1) return state;

      const newCells = [...notebook.cells];
      const temp = newCells[index + 1]!;
      newCells[index + 1] = newCells[index]!;
      newCells[index] = temp;

      return {
        notebooks: {
          ...state.notebooks,
          [notebookId]: {
            ...notebook,
            cells: newCells,
          },
        },
        notebookDirtyByFile: {
          ...state.notebookDirtyByFile,
          [notebookId]: true,
        },
      };
    }),
    updateCellSource: (notebookId: string, cellId: string, source: string[]) => set((state) => {
      const notebook = state.notebooks[notebookId];
      if (!notebook) return state;

      const cellIndex = notebook.cells.findIndex((cell) => cell.id === cellId);
      if (cellIndex === -1) {
        return state;
      }

      const previousCell = notebook.cells[cellIndex];
      if (
        previousCell
        && previousCell.source.length === source.length
        && previousCell.source.every((line, index) => line === source[index])
      ) {
        return state;
      }

      const nextCells = [...notebook.cells];
      nextCells[cellIndex] = previousCell
        ? { ...previousCell, source }
        : nextCells[cellIndex]!;

      return {
        notebooks: {
          ...state.notebooks,
          [notebookId]: {
            ...notebook,
            cells: nextCells,
          },
        },
        notebookDirtyByFile: {
          ...state.notebookDirtyByFile,
          [notebookId]: true,
        },
      };
    }),
    loadNotebook: (notebook) => set((state) => ({
      cellResults: omitRecordKeys(
        state.cellResults,
        [...new Set([
          ...(state.notebooks[notebook.id]?.cells.map((cell) => cell.id) ?? []),
          ...notebook.cells.map((cell) => cell.id),
        ])],
      ),
      runningCellIds: omitRecordKeys(
        state.runningCellIds,
        [...new Set([
          ...(state.notebooks[notebook.id]?.cells.map((cell) => cell.id) ?? []),
          ...notebook.cells.map((cell) => cell.id),
        ])],
      ),
      notebooks: {
        ...state.notebooks,
        [notebook.id]: notebook,
      },
      notebookDirtyByFile: {
        ...state.notebookDirtyByFile,
        [notebook.id]: false,
      },
      selectedFileId: notebook.id,
      activeCellId: notebook.cells[0]?.id ?? "",
    })),
    refreshFsDirectory: async (targetPath, isAdditive = true) => {
      const sessionCode = getSessionCode();
      if (!sessionCode) {
        return;
      }

      await loadFsDirectory(sessionCode, targetPath ?? (get().currentFsPath || "/"), { isAdditive });
    },
    openFsFile: async (targetPath) => {
      const sessionCode = getSessionCode();
      if (!sessionCode) {
        set({ serverStatus: "error", lastRunLabel: "Missing VM session for filesystem read" });
        return;
      }

      set({ isFsLoading: true, lastRunLabel: `${targetPath} / open fs file` });
      try {
        const file = await readRemoteVmFsFile(sessionCode, targetPath);
        set({
          isFsLoading: false,
          selectedFsPath: file.path,
          selectedFsIsText: file.isText,
          selectedFsContent: file.content ?? "",
          selectedFsContentBase64: file.contentBase64 ?? "",
          selectedFsSize: file.size,
          fsDraftContent: file.content ?? "",
          isFsDirty: false,
          lastRunLabel: `${file.path} / ready`,
        });
      } catch (error) {
        set({
          isFsLoading: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    updateFsDraft: (content) => set((state) => ({
      fsDraftContent: content,
      isFsDirty: state.selectedFsIsText && content !== state.selectedFsContent,
    })),
    saveFsFile: async () => {
      const sessionCode = getSessionCode();
      const state = get();
      if (!sessionCode || !state.selectedFsPath || !state.selectedFsIsText) {
        return;
      }

      set({ isFsSaving: true, serverStatus: "connecting", lastRunLabel: `${state.selectedFsPath} / save fs file` });
      try {
        await writeRemoteVmFsFile(sessionCode, state.selectedFsPath, {
          content: state.fsDraftContent,
        });
        set({
          isFsSaving: false,
          serverStatus: "ready",
          selectedFsContent: state.fsDraftContent,
          isFsDirty: false,
          lastRunLabel: `${state.selectedFsPath} / fs saved`,
        });
        await get().refreshFsDirectory(parentVmPath(state.selectedFsPath));
      } catch (error) {
        set({
          isFsSaving: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    createFsFile: async (targetPath) => {
      const sessionCode = getSessionCode();
      if (!sessionCode) {
        return;
      }

      const resolvedPath = targetPath ?? joinVmPath(get().currentFsPath, "untitled.txt");
      set({ isFsSaving: true, serverStatus: "connecting", lastRunLabel: `${resolvedPath} / create fs file` });
      try {
        await writeRemoteVmFsFile(sessionCode, resolvedPath, { content: "" });
        set({ isFsSaving: false, serverStatus: "ready" });
        await get().refreshFsDirectory(parentVmPath(resolvedPath));
        await get().openFsFile(resolvedPath);
      } catch (error) {
        set({
          isFsSaving: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    createFsDirectory: async (targetPath) => {
      const sessionCode = getSessionCode();
      if (!sessionCode) {
        return;
      }

      const resolvedPath = targetPath ?? joinVmPath(get().currentFsPath, "untitled");
      set({ isFsSaving: true, serverStatus: "connecting", lastRunLabel: `${resolvedPath} / create fs directory` });
      try {
        await createRemoteVmFsDirectory(sessionCode, resolvedPath);
        set({ isFsSaving: false, serverStatus: "ready", lastRunLabel: `${resolvedPath} / directory created` });
        await get().refreshFsDirectory(parentVmPath(resolvedPath));
      } catch (error) {
        set({
          isFsSaving: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    deleteFsEntry: async (targetPath) => {
      const sessionCode = getSessionCode();
      if (!sessionCode) {
        return;
      }

      set({ isFsSaving: true, serverStatus: "connecting", lastRunLabel: `${targetPath} / delete fs entry` });
      try {
        await deleteRemoteVmFsEntry(sessionCode, targetPath, true);
        const shouldClearSelection = get().selectedFsPath === targetPath;
        set({
          isFsSaving: false,
          serverStatus: "ready",
          lastRunLabel: `${targetPath} / deleted`,
          ...(shouldClearSelection ? clearFsSelection() : {}),
        });
        await get().refreshFsDirectory(parentVmPath(targetPath));
      } catch (error) {
        set({
          isFsSaving: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    uploadFsFile: async (file, targetDirectory) => {
      const sessionCode = getSessionCode();
      if (!sessionCode) {
        return;
      }

      const directoryPath = targetDirectory ?? get().currentFsPath;
      const targetPath = joinVmPath(directoryPath, file.name);
      set({ isFsSaving: true, serverStatus: "connecting", lastRunLabel: `${targetPath} / upload fs file` });
      try {
        const base64 = encodeArrayBufferToBase64(await file.arrayBuffer());
        await writeRemoteVmFsFile(sessionCode, targetPath, { contentBase64: base64 });
        set({ isFsSaving: false, serverStatus: "ready", lastRunLabel: `${targetPath} / uploaded` });
        await get().refreshFsDirectory(directoryPath);
      } catch (error) {
        set({
          isFsSaving: false,
          serverStatus: "error",
          lastRunLabel: error instanceof Error ? error.message : String(error),
        });
      }
    },
    downloadFsFile: async (targetPath) => {
      const sessionCode = getSessionCode();
      const resolvedPath = targetPath ?? get().selectedFsPath;
      if (!sessionCode || !resolvedPath) {
        return;
      }

      set({ serverStatus: "connecting", lastRunLabel: `${resolvedPath} / download fs file` });
      try {
        const blob = await downloadRemoteVmFsFile(sessionCode, resolvedPath);
        triggerBlobDownload(blob, resolvedPath.split("/").filter(Boolean).at(-1) ?? "download.bin");
        set({ serverStatus: "ready", lastRunLabel: `${resolvedPath} / downloaded` });
      } catch (error) {
        set({ serverStatus: "error", lastRunLabel: error instanceof Error ? error.message : String(error) });
      }
    },
    setModal: (type) => set({ activeModal: type }),
    closeModal: () => set((state) => {
      const baseState = {
        activeModal: null,
        activeBrowserProfileId: null,
        activePackageBoxId: null,
        activePackageBoxTab: "overview" as const,
      };

      if (state.activeModal === "file-editor" || state.activeModal === "file-preview") {
        return {
          ...baseState,
          ...clearFsSelection(),
        };
      }

      return baseState;
    }),
    openContextMenu: (contextMenu) => set({ contextMenu }),
    closeContextMenu: () => set({ contextMenu: null }),
    setTooltip: (text) => set({ tooltip: text }),
    setCompletionCache: (sessionCode, fragment, items) => set((state) => ({
      completionCache: {
        ...state.completionCache,
        [sessionCode]: { fragment, items },
      },
    })),
  };
});

useInterfaceStore.subscribe((state) => {
  if (state.selectedFileId) {
    const hash = `#${encodeURIComponent(state.selectedFileId)}${state.activeCellId ? `:${encodeURIComponent(state.activeCellId)}` : ""}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
  } else if (window.location.hash && state.hasBootstrapped) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
});
