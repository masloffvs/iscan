import { Suspense, lazy, useEffect, useMemo, useState, memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useInterfaceStore } from "./store/ui";
import { useShallow } from "zustand/react/shallow";
import { getFileIcon } from "./file-icons";
import { getNotebookDirectory, getNotebookGroupLabel, getNotebookLabel, sortNotebookPaths, type NotebookOrderState } from "./notebook-tree";
import workbookTheme from "./theme.tsx";
import GlobalBrowserAudio from "./components/GlobalBrowserAudio";

const Sidebar = lazy(() => import("./components/Sidebar"));
const ApplicationHost = lazy(() => import("./components/ApplicationHost"));
const NotebookView = lazy(() => import("./components/NotebookView"));
const VmFilePanel = lazy(() => import("./components/VmFilePanel"));
const StatusBar = lazy(() => import("./components/StatusBar"));
const Modal = lazy(() => import("./components/Modal"));
const BrowserProfileModalContent = lazy(() => import("./components/BrowserProfileModalContent"));
const PackageBoxModalContent = lazy(() => import("./components/PackageBoxModalContent"));
const CommandPalette = lazy(() => import("./components/CommandPalette"));
const ContextMenu = lazy(() => import("./components/ContextMenu"));
const Tooltip = lazy(() => import("./components/Tooltip"));

const LEFT_PANEL_WIDTH = 236;
const LEFT_PANEL_COLLAPSED_WIDTH = 54;
const RIGHT_PANEL_COLLAPSED_WIDTH = 54;
const LEFT_PANEL_COLLAPSED_STORAGE_KEY = "iscan:left-panel-collapsed";
const RIGHT_PANEL_COLLAPSED_STORAGE_KEY = "iscan:right-panel-collapsed";

function readPersistedCollapsedValue(storageKey: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(storageKey) === "1";
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  const rotation = direction === "left" ? "rotate-180" : "";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`h-4 w-4 ${rotation}`}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function AppsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z" />
    </svg>
  );
}

function SketchbookIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M4 2.75h7.25a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H4.75a2 2 0 0 1 0-4h6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4.75 9.25h6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M4 2.75v10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M5 2.75h4l2 2v7.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M9 2.75v2.5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function PackageIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M8 2.5 12.5 5v6L8 13.5 3.5 11V5L8 2.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M3.75 5.15 8 7.5l4.25-2.35" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M8 7.5v5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function FolderMarkerIcon() {
  return <img src="/icons/_folder.svg" className="h-4 w-4 opacity-70" alt="folder" />;
}

type CollapsedNotebookItem = {
  relativePath: string;
  label: string;
  iconPath: string;
  isDirty: boolean;
  isActive: boolean;
};

type CollapsedNotebookGroup = {
  key: string;
  label: string;
  tooltip: string;
  items: CollapsedNotebookItem[];
};

function buildCollapsedNotebookGroups(
  files: readonly { relativePath: string }[],
  dirtyByFile: Record<string, boolean>,
  selectedFileId: string,
  isNotebookActive: boolean,
  notebookOrderState: NotebookOrderState,
): CollapsedNotebookGroup[] {
  const groups = new Map<string, CollapsedNotebookGroup>();

  for (const file of files) {
    const directory = getNotebookDirectory(file.relativePath);
    const groupKey = directory.length > 0 ? directory : "__root__";
    const existingGroup = groups.get(groupKey);
    const group = existingGroup ?? {
      key: groupKey,
      label: getNotebookGroupLabel(directory),
      tooltip: directory.length > 0 ? directory : "workspace root",
      items: [],
    };

    const label = getNotebookLabel(file.relativePath);
    group.items.push({
      relativePath: file.relativePath,
      label,
      iconPath: getFileIcon(label),
      isDirty: Boolean(dirtyByFile[file.relativePath]),
      isActive: isNotebookActive && selectedFileId === file.relativePath,
    });

    groups.set(groupKey, group);
  }

  return [...groups.values()]
    .sort((left, right) => {
      if (left.key === "__root__") {
        return -1;
      }
      if (right.key === "__root__") {
        return 1;
      }
      return left.tooltip.localeCompare(right.tooltip);
    })
    .map((group) => ({
      ...group,
      items: sortNotebookPaths(
        group.items.map((item) => item.relativePath),
        group.key === "__root__" ? "" : group.key,
        notebookOrderState,
      ).map((relativePath) => group.items.find((item) => item.relativePath === relativePath)).filter((item): item is CollapsedNotebookItem => Boolean(item)),
    }));
}

const RailMarker = memo(function RailMarker({ title, children }: { title: string; children: React.ReactNode }) {
  const setTooltip = useInterfaceStore((state) => state.setTooltip);

  return (
    <div
      role="presentation"
      onMouseEnter={() => setTooltip(title)}
      onMouseLeave={() => setTooltip(null)}
      className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/[0.03] text-[#6e6e77]"
    >
      {children}
    </div>
  );
});

const RailGroupMarker = memo(function RailGroupMarker({ title, count }: { title: string; count: number }) {
  return (
    <RailMarker title={title}>
      <span className="relative flex h-7 w-7 items-center justify-center">
        <FolderMarkerIcon />
        <span className="absolute -bottom-0.5 -right-0.5 min-w-[13px] rounded-full bg-white/[0.1] px-1 text-center text-[8px] font-semibold leading-[13px] text-[#d7dbe1]">
          {count}
        </span>
      </span>
    </RailMarker>
  );
});

const RailButton = memo(function RailButton({
  title,
  onClick,
  active = false,
  children,
  disabled = false,
  dirty = false,
  showActiveBadge = false,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children?: React.ReactNode;
  disabled?: boolean;
  dirty?: boolean;
  showActiveBadge?: boolean;
}) {
  const setTooltip = useInterfaceStore((state) => state.setTooltip);

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseEnter={() => setTooltip(title)}
      onMouseLeave={() => setTooltip(null)}
      onFocus={() => setTooltip(title)}
      onBlur={() => setTooltip(null)}
      onClick={() => {
        setTooltip(null);
        onClick();
      }}
      className={`relative flex h-9 w-9 items-center justify-center rounded-2xl transition ${
        active
          ? "bg-white/[0.1] text-white"
          : disabled
            ? "cursor-default bg-white/[0.01] text-[#55555d] opacity-55"
            : "cursor-pointer bg-white/[0.02] text-[#86868f] hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      {children}
      {dirty ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#f6b25f] ring-2 ring-[#0d0d0d]" /> : null}
      {showActiveBadge ? <span className="absolute bottom-1 right-1 h-2 w-2 rounded-full bg-[#7dd3fc] ring-2 ring-[#0d0d0d] shadow-[0_0_10px_rgba(125,211,252,0.45)]" /> : null}
    </button>
  );
});

const CollapsedRail = memo(function CollapsedRail({ 
  onExpand, 
  onOpenApplications, 
  onOpenSketchbooks 
}: { 
  onExpand: () => void;
  onOpenApplications: () => void;
  onOpenSketchbooks: () => void;
}) {
  const selectedFileId = useInterfaceStore((state) => state.selectedFileId);
  const selectedApplicationInstanceId = useInterfaceStore((state) => state.selectedApplicationInstanceId);
  const applicationInstancesCount = useInterfaceStore((state) => state.applicationInstances.length);
  const isbFiles = useInterfaceStore((state) => state.isbFiles);
  const notebookDirtyByFile = useInterfaceStore(useShallow((state) => state.notebookDirtyByFile));
  const notebookOrderState = useInterfaceStore(useShallow((state) => state.notebookOrderState));
  const switchRemoteFile = useInterfaceStore((state) => state.switchRemoteFile);

  const collapsedNotebookGroups = useMemo(
    () => buildCollapsedNotebookGroups(isbFiles, notebookDirtyByFile, selectedFileId, selectedApplicationInstanceId === null, notebookOrderState),
    [isbFiles, notebookDirtyByFile, notebookOrderState, selectedApplicationInstanceId, selectedFileId],
  );
  const showNotebookGroupMarkers = collapsedNotebookGroups.length > 1 || collapsedNotebookGroups.some((group) => group.key !== "__root__");

  return (
    <div className="flex h-full flex-col px-2 py-3">
      <div className="flex flex-col items-center gap-2.5">
        <RailButton title="Expand workspace panel" onClick={onExpand}>
          <ChevronIcon direction="right" />
        </RailButton>
        <RailButton
          title={applicationInstancesCount > 0 ? "Applications" : "Applications panel"}
          active={selectedApplicationInstanceId !== null}
          onClick={onOpenApplications}
        >
          <AppsIcon />
        </RailButton>
      </div>
      <div className="dense-scroll mt-3 flex min-h-0 grow flex-col items-center gap-3 overflow-y-auto pb-2">
        {collapsedNotebookGroups.length > 0 ? collapsedNotebookGroups.map((group) => (
          <div key={group.key} className="flex w-full flex-col items-center gap-2">
            {showNotebookGroupMarkers ? (
              <RailGroupMarker title={`${group.tooltip} • ${group.items.length} sketchbook(s)`} count={group.items.length} />
            ) : null}
            {group.items.map((item) => (
              <RailButton
                key={item.relativePath}
                title={item.relativePath}
                active={item.isActive}
                dirty={item.isDirty}
                showActiveBadge={item.isActive}
                onClick={() => {
                  void switchRemoteFile(item.relativePath);
                }}
              >
                <img src={item.iconPath} className="h-4 w-4 opacity-90" alt={item.label} />
              </RailButton>
            ))}
          </div>
        )) : (
          <RailButton title="No sketchbooks yet" onClick={onOpenSketchbooks} disabled>
            <SketchbookIcon />
          </RailButton>
        )}
      </div>
    </div>
  );
});

const FileModalContent = memo(function FileModalContent() {
  const selectedFsPath = useInterfaceStore((state) => state.selectedFsPath);
  const selectedFsIsText = useInterfaceStore((state) => state.selectedFsIsText);
  const selectedFsSize = useInterfaceStore((state) => state.selectedFsSize);
  const fsDraftContent = useInterfaceStore((state) => state.fsDraftContent);
  const updateFsDraft = useInterfaceStore((state) => state.updateFsDraft);
  const saveFsFile = useInterfaceStore((state) => state.saveFsFile);
  const isFsDirty = useInterfaceStore((state) => state.isFsDirty);
  const isFsSaving = useInterfaceStore((state) => state.isFsSaving);
  const downloadFsFile = useInterfaceStore((state) => state.downloadFsFile);

  function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (selectedFsIsText) {
    return (
      <div className="h-[55vh] flex flex-col gap-3">
        <div className="flex items-center justify-between shrink-0">
          <span className="text-[10px] uppercase tracking-[0.2em] text-[#68686e]">{formatBytes(selectedFsSize)}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void saveFsFile(); }}
              disabled={!isFsDirty || isFsSaving}
              className="rounded-xl cursor-pointer bg-white/[0.08] px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white transition hover:bg-white/[0.12] disabled:opacity-30"
            >
              {isFsSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
        <textarea
          value={fsDraftContent}
          onChange={(event) => updateFsDraft(event.target.value)}
          className="w-full grow resize-none rounded-xl bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-[#e4e4e7] outline-none border border-white/5 focus:border-white/10 transition"
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div className="py-8 flex flex-col items-center justify-center gap-5 text-center">
      <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-[#68686e]"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
      </div>
      <div>
        <p className="text-xs font-medium text-[#d6d6db]">Binary file, preview disabled.</p>
        <p className="mt-1 text-[10px] text-[#68686e] tracking-tight">{formatBytes(selectedFsSize)}</p>
      </div>
      <button
        type="button"
        onClick={() => { void downloadFsFile(selectedFsPath); }}
        className="rounded-xl cursor-pointer bg-white/[0.08] px-6 py-2 text-[10px] font-bold uppercase tracking-wider text-white transition hover:bg-white/[0.12]"
      >
        Download
      </button>
    </div>
  );
});

export default function App() {
  const bootstrap = useInterfaceStore((state) => state.bootstrap);
  const selectedFileId = useInterfaceStore((state) => state.selectedFileId);
  const selectedApplicationInstanceId = useInterfaceStore((state) => state.selectedApplicationInstanceId);
  const selectedFsPath = useInterfaceStore((state) => state.selectedFsPath);
  const activeModal = useInterfaceStore((state) => state.activeModal);
  const activeBrowserProfileId = useInterfaceStore((state) => state.activeBrowserProfileId);
  const browserProfiles = useInterfaceStore(useShallow((state) => state.browserProfiles));
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);
  const packageBoxes = useInterfaceStore(useShallow((state) => state.packageBoxes));
  const applicationInstances = useInterfaceStore(useShallow((state) => state.applicationInstances));
  const isbFiles = useInterfaceStore(useShallow((state) => state.isbFiles));
  const selectRightPanelTab = useInterfaceStore((state) => state.selectRightPanelTab);
  const selectApplicationInstance = useInterfaceStore((state) => state.selectApplicationInstance);
  const switchRemoteFile = useInterfaceStore((state) => state.switchRemoteFile);
  const [isLeftPanelCollapsed, setLeftPanelCollapsed] = useState(() => readPersistedCollapsedValue(LEFT_PANEL_COLLAPSED_STORAGE_KEY));
  const [isRightPanelCollapsed, setRightPanelCollapsed] = useState(() => readPersistedCollapsedValue(RIGHT_PANEL_COLLAPSED_STORAGE_KEY));

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "enter" && (event.ctrlKey || event.metaKey) && event.shiftKey) {
        event.preventDefault();
        const state = useInterfaceStore.getState();
        if (state.selectedFileId && state.activeCellId) {
          void state.runCell(state.selectedFileId, state.activeCellId);
        }
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }

      if (event.key.toLowerCase() !== "s") {
        return;
      }

      event.preventDefault();
      const state = useInterfaceStore.getState();
      
      if (state.selectedFsPath && state.selectedFsIsText && state.isFsDirty && !state.isFsSaving) {
        void state.saveFsFile();
        return;
      }

      if (!state.selectedFileId || !state.sessionCodeByFile[state.selectedFileId] || state.isSaving) {
        return;
      }

      void state.saveNotebook(state.selectedFileId);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const handlePaletteKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }

      if (event.key.toLowerCase() !== "k") {
        return;
      }

      event.preventDefault();
      const state = useInterfaceStore.getState();
      if (state.commandPaletteOpen) {
        state.closeCommandPalette();
        return;
      }

      state.openCommandPalette();
    };

    window.addEventListener("keydown", handlePaletteKeyDown);
    return () => {
      window.removeEventListener("keydown", handlePaletteKeyDown);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(LEFT_PANEL_COLLAPSED_STORAGE_KEY, isLeftPanelCollapsed ? "1" : "0");
  }, [isLeftPanelCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(RIGHT_PANEL_COLLAPSED_STORAGE_KEY, isRightPanelCollapsed ? "1" : "0");
  }, [isRightPanelCollapsed]);

  const rightPanelTab = useInterfaceStore((state) => state.rightPanelTab);
  const rightPanelOpenWidth = rightPanelTab === "packages" ? 592 : 352;
  const rightPanelWidth = isRightPanelCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : rightPanelOpenWidth;
  const leftPanelWidth = isLeftPanelCollapsed ? LEFT_PANEL_COLLAPSED_WIDTH : LEFT_PANEL_WIDTH;
  const activeBrowserProfile = browserProfiles.find((entry) => entry.id === activeBrowserProfileId) ?? null;
  const activePackageBox = packageBoxes.find((entry) => entry.id === activePackageBoxId) ?? null;
  const modalTitle = activeModal === "package-box"
    ? activePackageBox?.name ?? activePackageBoxId ?? "Box"
    : activeModal === "browser-profile"
      ? activeBrowserProfile?.name ?? activeBrowserProfileId ?? "Browser Settings"
      : selectedFsPath.split('/').pop() || "File Editor";

  const handleExpandRightPanel = (tab?: "files" | "packages") => {
    if (tab) {
      void selectRightPanelTab(tab);
    }

    setRightPanelCollapsed(false);
  };

  const handleOpenApplications = () => {
    setLeftPanelCollapsed(false);

    if (selectedApplicationInstanceId) {
      selectApplicationInstance(selectedApplicationInstanceId);
      return;
    }

    const firstApplication = applicationInstances[0];
    if (firstApplication) {
      selectApplicationInstance(firstApplication.instanceId);
    }
  };

  const handleOpenSketchbooks = () => {
    setLeftPanelCollapsed(false);

    if (selectedApplicationInstanceId !== null) {
      selectApplicationInstance(null);
    }

    if (selectedFileId) {
      return;
    }

    const firstNotebook = isbFiles[0]?.relativePath;
    if (firstNotebook) {
      void switchRemoteFile(firstNotebook);
    }
  };

  return (
    <main className={`relative isolate h-screen flex flex-col overflow-hidden ${workbookTheme.surface.canvas} ${workbookTheme.text.canvas}`}>
      <GlobalBrowserAudio />
      <section className="relative grow min-h-0 flex">
        <motion.aside
          initial={false}
          animate={{ width: leftPanelWidth }}
          transition={{ type: "spring", stiffness: 260, damping: 30, mass: 0.9 }}
          className={`h-full shrink-0 overflow-hidden ${workbookTheme.surface.rail}`}
        >
          {isLeftPanelCollapsed ? (
            <CollapsedRail 
              onExpand={() => setLeftPanelCollapsed(false)}
              onOpenApplications={handleOpenApplications}
              onOpenSketchbooks={handleOpenSketchbooks}
            />
          ) : (
            <Suspense fallback={<div className={`${workbookTheme.surface.rail} h-full w-full`} />}>
              <Sidebar onCollapse={() => setLeftPanelCollapsed(true)} />
            </Suspense>
          )}
        </motion.aside>

        <div className="min-w-0 grow">
          <Suspense fallback={<div className={`${workbookTheme.surface.canvas} h-full w-full`} />}>
            {selectedApplicationInstanceId ? <ApplicationHost /> : <NotebookView />}
          </Suspense>
        </div>

        <motion.div
          initial={false}
          animate={{ width: rightPanelWidth }}
          transition={{ type: "spring", stiffness: 240, damping: 30, mass: 0.9 }}
          className={`h-full min-w-0 shrink-0 overflow-hidden ${workbookTheme.surface.rail}`}
        >
          {isRightPanelCollapsed ? (
            <div className="flex h-full flex-col items-center gap-2.5 px-2 py-3">
              <RailButton title="Expand tools panel" onClick={() => handleExpandRightPanel()}>
                <ChevronIcon direction="left" />
              </RailButton>
              <RailButton
                title="Open files panel"
                active={rightPanelTab === "files"}
                onClick={() => handleExpandRightPanel("files")}
              >
                <FilesIcon />
              </RailButton>
              <RailButton
                title="Open packages panel"
                active={rightPanelTab === "packages"}
                onClick={() => handleExpandRightPanel("packages")}
              >
                <PackageIcon />
              </RailButton>
            </div>
          ) : (
            <Suspense fallback={<div className="bg-[#0d0d0d] h-full w-full" />}>
              <VmFilePanel onCollapse={() => setRightPanelCollapsed(true)} />
            </Suspense>
          )}
        </motion.div>
      </section>

      <Suspense fallback={null}>
        <StatusBar />
      </Suspense>

      <AnimatePresence>
        {activeModal && (
          <Suspense fallback={null}>
            <Modal title={modalTitle}>
              {activeModal === "file-editor" || activeModal === "file-preview" ? <FileModalContent /> : null}
              {activeModal === "browser-profile" ? <BrowserProfileModalContent /> : null}
              {activeModal === "package-box" ? <PackageBoxModalContent /> : null}
            </Modal>
          </Suspense>
        )}
      </AnimatePresence>

      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>

      <Suspense fallback={null}>
        <ContextMenu />
      </Suspense>

      <Suspense fallback={null}>
        <Tooltip />
      </Suspense>
    </main>
  );
}
