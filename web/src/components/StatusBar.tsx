import { useInterfaceStore } from "../store/ui";

export default function StatusBar() {
  const kernelStatus = useInterfaceStore((state) => state.kernelStatus);
  const serverStatus = useInterfaceStore((state) => state.serverStatus);
  const isSaving = useInterfaceStore((state) => state.isSaving);
  const isFsSaving = useInterfaceStore((state) => state.isFsSaving);
  const currentFsPath = useInterfaceStore((state) => state.currentFsPath);
  const isFsDirty = useInterfaceStore((state) => state.isFsDirty);
  const selectedFileId = useInterfaceStore((state) => state.selectedFileId);
  const lastRunLabel = useInterfaceStore((state) => state.lastRunLabel);

  const statusTone = serverStatus === "error"
    ? "bg-rose-500/60"
    : serverStatus === "connecting" || isSaving || isFsSaving
      ? "bg-amber-400/60"
      : "bg-emerald-500/50";

  const statusLabel = isSaving || isFsSaving
    ? "Saving"
    : serverStatus === "connecting"
      ? "Connecting"
      : serverStatus === "error"
        ? "Error"
        : "Ready";

  return (
    <footer className="flex items-center justify-between px-3 py-1 bg-[#0d0d0d] z-20 shrink-0 text-[#9b9ba2] text-[10px]">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusTone}`} />
          <span className="uppercase tracking-[0.1em]">{statusLabel}</span>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-[0.1em] text-[#68686e]">File:</span>
          <span className="truncate max-w-[200px] text-right text-[#c9c9cf]">{selectedFileId || "none"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-[0.1em] text-[#68686e]">Kernel:</span>
          <span className="text-[#c9c9cf]">{kernelStatus}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-[0.1em] text-[#68686e]">FS:</span>
          <span className="truncate max-w-[160px] text-right text-[#c9c9cf]">{currentFsPath}{isFsDirty ? " *" : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-[0.1em] text-[#68686e]">Last:</span>
          <span className="truncate max-w-[200px] text-right">{lastRunLabel}</span>
        </div>
      </div>
    </footer>
  );
}
