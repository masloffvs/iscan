import { useInterfaceStore } from "../store/ui";

export default function Header() {
  const selectedFileId = useInterfaceStore((state) => state.selectedFileId);
  const notebookTitle = useInterfaceStore((state) => state.notebooks[selectedFileId]?.title ?? "Notebook");
  const notebookPath = useInterfaceStore((state) => state.notebooks[selectedFileId]?.path ?? "");

  return (
    <header className="shrink-0 px-1 pb-2 pt-2">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <img src="/icons/jupyter.png" className="h-4 w-4 opacity-80" alt="notebook" />
          <h2 className="truncate text-[13px] font-semibold text-[#e0e0e0]">{notebookTitle}</h2>
        </div>
        {notebookPath && (
          <p className="mt-1 pl-7 text-[11px] text-[#7e8087]">{notebookPath}</p>
        )}
      </div>
    </header>
  );
}
