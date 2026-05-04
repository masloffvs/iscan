import { useInterfaceStore } from "../store/ui";
import { kernelProfiles, getDefaultNotebook, type NotebookCell } from "../data";

function getExecutionCount(cell: NotebookCell, executionCounts: Record<string, number>): number | undefined {
  return executionCounts[cell.id] ?? cell.executionCount;
}

export default function Header() {
  const selectedFileId = useInterfaceStore((state) => state.selectedFileId);
  const activeCellId = useInterfaceStore((state) => state.activeCellId);
  const executionCounts = useInterfaceStore((state) => state.executionCounts);
  const runCell = useInterfaceStore((state) => state.runCell);
  const runNotebook = useInterfaceStore((state) => state.runNotebook);
  const stopExecution = useInterfaceStore((state) => state.stopExecution);
  const restartKernel = useInterfaceStore((state) => state.restartKernel);
  const reloadNotebook = useInterfaceStore((state) => state.reloadNotebook);
  const saveNotebook = useInterfaceStore((state) => state.saveNotebook);
  const isSaving = useInterfaceStore((state) => state.isSaving);
  const setTooltip = useInterfaceStore((state) => state.setTooltip);

  const notebookTitle = useInterfaceStore((state) => state.notebooks[selectedFileId]?.title ?? "Notebook");
  const notebookPath = useInterfaceStore((state) => state.notebooks[selectedFileId]?.path ?? "");
  const hasCodeCells = useInterfaceStore((state) => state.notebooks[selectedFileId]?.cells.some(c => c.kind === 'code') ?? false);
  const hasRemoteSession = useInterfaceStore((state) => typeof state.sessionCodeByFile[selectedFileId] === "string");

  const activeCell = useInterfaceStore((state) => state.notebooks[selectedFileId]?.cells.find((cell) => cell.id === activeCellId));
  const activeCodeCell = activeCell?.kind === "code" ? activeCell : undefined;

  const handleRunNotebook = () => {
    void runNotebook(selectedFileId);
  };

  const handleRunCell = (cell: NotebookCell) => {
    void runCell(selectedFileId, cell.id);
  };

  const handleRunActiveCell = () => {
    if (!activeCodeCell) return;
    handleRunCell(activeCodeCell);
  };

  const handleSave = () => {
    void saveNotebook(selectedFileId);
  };

  return (
    <header className="flex items-center justify-between px-5 py-2 bg-transparent absolute w-full backdrop-blur-sm z-10 shrink-0">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-3">
          <img src="/icons/jupyter.png" className="w-4 h-4 opacity-80" alt="notebook" />
          <h2 className="truncate text-[13px] font-semibold text-[#e0e0e0]">{notebookTitle}</h2>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-0.5 bg-white/[0.02] p-0.5 rounded-md">
          <button
            type="button"
            title="Run Cell"
            onMouseEnter={() => setTooltip("Run active cell")}
            onMouseLeave={() => setTooltip(null)}
            onClick={handleRunActiveCell}
            disabled={!activeCodeCell || !hasRemoteSession}
            className="flex items-center justify-center cursor-pointer w-7 h-7 rounded-md text-[#a0a0a8] transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 5.14v14l11-7-11-7z" /></svg>
          </button>
          <button
            type="button"
            title="Run All"
            onMouseEnter={() => setTooltip("Run all cells")}
            onMouseLeave={() => setTooltip(null)}
            onClick={handleRunNotebook}
            disabled={!hasRemoteSession || !hasCodeCells}
            className="flex items-center justify-center cursor-pointer w-7 h-7 rounded-md text-[#a0a0a8] transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M16 5.14v14l8-7-8-7zM2 5.14v14l11-7-11-7z" /></svg>
          </button>
          <div className="w-px h-3.5 bg-white/10 mx-1" />
          <button
            type="button"
            title="Stop"
            onMouseEnter={() => setTooltip("Stop execution")}
            onMouseLeave={() => setTooltip(null)}
            onClick={() => stopExecution(`${notebookPath} / stop`)}
            className="flex items-center justify-center cursor-pointer w-7 h-7 rounded-md text-[#a0a0a8] transition hover:bg-white/[0.08] hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M6 6h12v12H6z" /></svg>
          </button>
          <button
            type="button"
            title="Restart Kernel"
            onMouseEnter={() => setTooltip("Restart kernel")}
            onMouseLeave={() => setTooltip(null)}
            onClick={() => {
              void restartKernel(selectedFileId);
            }}
            disabled={!hasRemoteSession}
            className="flex items-center justify-center cursor-pointer w-7 h-7 rounded-md text-[#a0a0a8] transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
          </button>
          <button
            type="button"
            title="Reload From Disk"
            onMouseEnter={() => setTooltip("Reload from disk")}
            onMouseLeave={() => setTooltip(null)}
            onClick={() => {
              void reloadNotebook(selectedFileId);
            }}
            disabled={!hasRemoteSession}
            className="flex items-center justify-center cursor-pointer w-7 h-7 rounded-md text-[#a0a0a8] transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" /></svg>
          </button>
          <button
            type="button"
            title="Save"
            onMouseEnter={() => setTooltip("Save notebook")}
            onMouseLeave={() => setTooltip(null)}
            onClick={handleSave}
            disabled={!hasRemoteSession || isSaving}
            className="flex items-center justify-center cursor-pointer w-7 h-7 rounded-md text-[#a0a0a8] transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
          </button>
        </div>
      </div>
    </header>
  );
}
