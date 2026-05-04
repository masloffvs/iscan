import { Suspense, lazy, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useInterfaceStore } from "./store/ui";

const Sidebar = lazy(() => import("./components/Sidebar"));
const NotebookView = lazy(() => import("./components/NotebookView"));
const VmFilePanel = lazy(() => import("./components/VmFilePanel"));
const StatusBar = lazy(() => import("./components/StatusBar"));
const Modal = lazy(() => import("./components/Modal"));
const PackageBoxModalContent = lazy(() => import("./components/PackageBoxModalContent"));
const ContextMenu = lazy(() => import("./components/ContextMenu"));
const Tooltip = lazy(() => import("./components/Tooltip"));

function FileModalContent() {
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
}

export default function App() {
  const bootstrap = useInterfaceStore((state) => state.bootstrap);
  const selectedFileId = useInterfaceStore((state) => state.selectedFileId);
  const sessionCodeByFile = useInterfaceStore((state) => state.sessionCodeByFile);
  const saveNotebook = useInterfaceStore((state) => state.saveNotebook);
  const isSaving = useInterfaceStore((state) => state.isSaving);
  const selectedFsPath = useInterfaceStore((state) => state.selectedFsPath);
  const selectedFsIsText = useInterfaceStore((state) => state.selectedFsIsText);
  const isFsDirty = useInterfaceStore((state) => state.isFsDirty);
  const saveFsFile = useInterfaceStore((state) => state.saveFsFile);
  const isFsSaving = useInterfaceStore((state) => state.isFsSaving);
  const activeModal = useInterfaceStore((state) => state.activeModal);
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);
  const packageBoxes = useInterfaceStore((state) => state.packageBoxes);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }

      if (event.key.toLowerCase() !== "s") {
        return;
      }

      event.preventDefault();
      if (selectedFsPath && selectedFsIsText && isFsDirty && !isFsSaving) {
        void saveFsFile();
        return;
      }

      if (!selectedFileId || !sessionCodeByFile[selectedFileId] || isSaving) {
        return;
      }

      void saveNotebook(selectedFileId);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFsDirty, isFsSaving, isSaving, saveFsFile, saveNotebook, selectedFileId, selectedFsIsText, selectedFsPath, sessionCodeByFile]);

  const rightPanelTab = useInterfaceStore((state) => state.rightPanelTab);
  const rightPanelWidth = rightPanelTab === "browsers" || rightPanelTab === "packages" ? 640 : 392;
  const activePackageBox = packageBoxes.find((entry) => entry.id === activePackageBoxId) ?? null;
  const modalTitle = activeModal === "package-box"
    ? activePackageBox?.name ?? activePackageBoxId ?? "Box"
    : selectedFsPath.split('/').pop() || "File Editor";

  return (
    <main className="relative isolate h-screen flex flex-col overflow-hidden bg-[#171717] text-[#f5f5f5]">
      <section className="relative grow min-h-0 flex">
        <div className="h-full w-[280px] min-w-[280px] shrink-0">
          <Suspense fallback={<div className="bg-[#0d0d0d] h-full w-full" />}>
            <Sidebar />
          </Suspense>
        </div>

        <div className="min-w-0 grow">
          <Suspense fallback={<div className="bg-[#171717] h-full w-full" />}>
            <NotebookView />
          </Suspense>
        </div>

        <motion.div
          initial={false}
          animate={{ width: rightPanelWidth }}
          transition={{ type: "spring", stiffness: 240, damping: 30, mass: 0.9 }}
          className="h-full min-w-0 shrink-0 overflow-hidden"
        >
          <Suspense fallback={<div className="bg-[#0d0d0d] h-full w-full" />}>
            <VmFilePanel />
          </Suspense>
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
              {activeModal === "package-box" ? <PackageBoxModalContent /> : null}
            </Modal>
          </Suspense>
        )}
      </AnimatePresence>

      <Suspense fallback={null}>
        <ContextMenu />
      </Suspense>

      <Suspense fallback={null}>
        <Tooltip />
      </Suspense>
    </main>
  );
}
