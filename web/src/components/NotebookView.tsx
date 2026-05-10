import {
  Suspense,
  lazy,
  memo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useInterfaceStore } from "../store/ui";
import {
  getDefaultNotebook,
  type NotebookCell,
} from "../data";
import { useShallow } from "zustand/react/shallow";
import { formatOutputForCopy, outputCopyOptions, type OutputCopyFormat } from "../output-copy";

const Header = lazy(() => import("./Header"));
const CodeCellEditor = lazy(() => import("./CodeCellEditor"));
const StructuredCellOutput = lazy(() => import("./StructuredCellOutput/index"));

function isStructuredCellResult(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}

function readPersistedStructuredCellResult(output: readonly string[] | undefined): Record<string, unknown> | unknown[] | null {
  if (!output || output.length === 0) {
    return null;
  }

  const serializedValue = output.join("\n").trim();
  if (!serializedValue.startsWith("{") && !serializedValue.startsWith("[")) {
    return null;
  }

  try {
    const parsed = JSON.parse(serializedValue) as unknown;
    return isStructuredCellResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasSelectedText(): boolean {
  return (window.getSelection()?.toString().trim().length ?? 0) > 0;
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function CellMarker({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5 pt-1 select-none">
      <span className="pr-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#90939b]">
        {label}
      </span>
      <span className="pr-1 font-mono text-[10px] text-[#5f626a]">
        {value}
      </span>
    </div>
  );
}

const Cell = memo(function Cell({
  cell,
  index,
  cellsCount,
  selectedNotebookId,
}: {
  cell: NotebookCell;
  index: number;
  cellsCount: number;
  selectedNotebookId: string;
}) {
  const isActive = useInterfaceStore((state) => state.activeCellId === cell.id);
  const isRunning = useInterfaceStore((state) => Boolean(state.runningCellIds[cell.id]));
  const cellResult = useInterfaceStore((state) => state.cellResults[cell.id]);
  const executionCount = useInterfaceStore((state) => state.executionCounts[cell.id] ?? cell.executionCount);
  const sessionCode = useInterfaceStore((state) => state.sessionCodeByFile[selectedNotebookId]);
  
  const focusCell = useInterfaceStore((state) => state.focusCell);
  const runCell = useInterfaceStore((state) => state.runCell);
  const addCellAfter = useInterfaceStore((state) => state.addCellAfter);
  const deleteCell = useInterfaceStore((state) => state.deleteCell);
  const updateCellSource = useInterfaceStore((state) => state.updateCellSource);
  const moveCellUp = useInterfaceStore((state) => state.moveCellUp);
  const moveCellDown = useInterfaceStore((state) => state.moveCellDown);
  const openContextMenu = useInterfaceStore((state) => state.openContextMenu);
  const [copiedFormat, setCopiedFormat] = useState<OutputCopyFormat | null>(null);
  const [selectedTableCopyState, setSelectedTableCopyState] = useState<{ tableId: string; text: string } | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const isExecutableCell = cell.kind !== "markdown";
  const cellLanguage = cell.language ?? (cell.kind === "sql" ? "sql" : cell.kind === "code" ? "javascript" : undefined);
  const sourceText = cell.source.join("\n");
  const structuredOutput = isStructuredCellResult(cellResult)
    ? cellResult
    : readPersistedStructuredCellResult(cell.output);
  const outputText = cell.output?.join("\n") ?? "";
  const outputCopyValue = structuredOutput ?? outputText;

  const handleRunCell = () => {
    void runCell(selectedNotebookId, cell.id);
  };

  const showCopiedBadge = (format: OutputCopyFormat) => {
    setCopiedFormat(format);
    window.setTimeout(() => {
      setCopiedFormat((current) => current === format ? null : current);
    }, 1400);
  };

  const handleTableSelectionCopyTextChange = (tableId: string, text: string | null) => {
    setSelectedTableCopyState((current) => {
      if (text && text.length > 0) {
        return { tableId, text };
      }

      if (current?.tableId === tableId) {
        return null;
      }

      return current;
    });
  };

  const handleCopyOutput = async (format: OutputCopyFormat) => {
    const formattedOutput = format === "text" && selectedTableCopyState?.text
      ? selectedTableCopyState.text
      : formatOutputForCopy(outputCopyValue, format, {
        plainText: outputText,
        xmlRootTag: "output",
      });
    await copyTextToClipboard(formattedOutput);
    showCopiedBadge(format);
  };

  const openOutputCopyMenu = (position?: { x: number; y: number }) => {
    const rect = outputRef.current?.getBoundingClientRect();
    const fallbackX = rect ? rect.right - 16 : 24;
    const fallbackY = rect ? rect.top + 16 : 24;

    openContextMenu({
      x: position?.x ?? fallbackX,
      y: position?.y ?? fallbackY,
      items: outputCopyOptions.map((option) => ({
        id: `copy-output-${cell.id}-${option.format}`,
        label: `Copy as ${option.label}`,
        shortcut: option.shortcut,
        tone: option.format === "json" ? "accent" : "default",
        onSelect: async () => {
          await handleCopyOutput(option.format);
        },
      })),
    });
  };

  const handleOutputKeyDown = async (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.shiftKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      setCopiedFormat(null);
      openOutputCopyMenu();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "c") {
      if (hasSelectedText()) {
        return;
      }

      event.preventDefault();
      await handleCopyOutput("text");
      return;
    }
  };

  const handleOutputCopy = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (hasSelectedText()) {
      return;
    }

    const formattedOutput = selectedTableCopyState?.text
      ? selectedTableCopyState.text
      : formatOutputForCopy(outputCopyValue, "text", {
        plainText: outputText,
        xmlRootTag: "output",
      });

    event.preventDefault();
    event.clipboardData.setData("text/plain", formattedOutput);
    showCopiedBadge("text");
  };

  return (
    <article className="group relative py-1.5">
      <div className="space-y-1.5">
        <div className="grid grid-cols-[46px_minmax(0,1fr)] gap-3">
        <div className="text-right">
          {isExecutableCell ? (
            <button type="button" onClick={() => focusCell(cell.id)} className="w-full text-right">
              <CellMarker label="In" value={isRunning ? "*" : String(executionCount ?? " ")} />
            </button>
          ) : (
            <button type="button" onClick={() => focusCell(cell.id)} className="w-full text-right">
              <CellMarker label="Text" value={String(index + 1).padStart(2, "0")} />
            </button>
          )}
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => focusCell(cell.id)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              focusCell(cell.id);
            }
          }}
          className={`min-w-0 w-full outline-none transition ${isExecutableCell && !isActive ? "cursor-pointer px-3" : isExecutableCell ? "px-3" : ""}`}
        >
          {cell.kind === "markdown" ? (
            <textarea
              value={cell.source.join("\n")}
              onChange={(e) => updateCellSource(selectedNotebookId, cell.id, e.target.value.split("\n"))}
              className="w-full cursor-text resize-none overflow-hidden bg-transparent px-2 font-sans text-[13px] leading-relaxed text-[#d6d6db] outline-none"
              rows={cell.source.length || 1}
            />
          ) : (
            <div className={`w-full origin-top rounded-[12px] bg-[#17181a] px-1.5 py-1 transition-transform duration-150 ease-out ${isActive ? "" : "hover:scale-[1.002]"}`}>
              <div className="text-[12px] font-mono">
                {isActive ? (
                  <Suspense
                    fallback={(
                      <textarea
                        value={sourceText}
                        onChange={(event) => updateCellSource(selectedNotebookId, cell.id, event.target.value.split("\n"))}
                        className="w-full cursor-text resize-none overflow-hidden bg-transparent px-2 py-1 font-mono text-[12px] leading-relaxed text-[#d6d6db] outline-none"
                        rows={cell.source.length || 1}
                      />
                    )}
                  >
                    <CodeCellEditor
                      cellId={cell.id}
                      value={sourceText}
                      language={cellLanguage}
                      sessionCode={sessionCode}
                      onChange={(value) => updateCellSource(selectedNotebookId, cell.id, value.split("\n"))}
                      onRun={() => {
                        void runCell(selectedNotebookId, cell.id);
                      }}
                    />
                  </Suspense>
                ) : (
                  <pre className="dense-scroll min-h-[32px] overflow-x-auto whitespace-pre-wrap px-2 py-1 font-mono text-[12px] leading-relaxed text-[#d6d6db]">
                    {sourceText || " "}
                  </pre>
                )}
              </div>
            </div>
          )}

          {isRunning && (
            <div className="mt-2">
              <div className="relative h-[2px] overflow-hidden rounded-full bg-white/[0.05]">
                <div className="notebook-progress-bar notebook-progress-bar-primary absolute inset-y-0 w-[38%] bg-white/[0.48]" />
                <div className="notebook-progress-bar notebook-progress-bar-secondary absolute inset-y-0 w-[24%] bg-white/[0.22]" />
              </div>
            </div>
          )}
        </div>
      </div>

      {cell.output && cell.output.length > 0 && (
        <div className="grid grid-cols-[46px_minmax(0,1fr)] gap-3">
          <div className="text-right">
            <CellMarker label="Out" value={String(executionCount ?? " ")} />
          </div>

          <div
            ref={outputRef}
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              focusCell(cell.id);
            }}
            onKeyDown={handleOutputKeyDown}
            onCopy={handleOutputCopy}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              focusCell(cell.id);
              setCopiedFormat(null);
              openOutputCopyMenu({ x: event.clientX, y: event.clientY });
            }}
            className="dense-scroll relative min-w-0 overflow-x-auto px-3 py-1 font-mono text-[11px] leading-relaxed text-[#dfdfe3] outline-none focus-visible:ring-1 focus-visible:ring-white/8"
          >
            {copiedFormat && (
              <div className="pointer-events-none absolute right-2 top-1 z-10 flex flex-wrap items-center justify-end gap-1.5">
                <span className="rounded-md bg-[#0f0f10]/90 px-2 py-1 text-[9px] font-medium uppercase tracking-[0.12em] text-[#d5d6db]">
                  Copied {copiedFormat}
                </span>
              </div>
            )}
            {structuredOutput ? (
              <Suspense fallback={<pre className="whitespace-pre-wrap">{JSON.stringify(structuredOutput, null, 2)}</pre>}>
                <StructuredCellOutput
                  value={structuredOutput}
                  onTableSelectionCopyTextChange={handleTableSelectionCopyTextChange}
                />
              </Suspense>
            ) : (
              <pre className="whitespace-pre-wrap">{cell.output.join("\n")}</pre>
            )}
          </div>
        </div>
      )}
      </div>

      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex justify-end pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <div className="pointer-events-auto sticky top-4 self-start rounded-[10px] bg-[#101011]/92 p-1 shadow-[0_14px_34px_rgba(0,0,0,0.34)] backdrop-blur-sm">
          <div className="flex flex-col gap-1">
          {isExecutableCell && (
            <button
              type="button"
              title={isRunning ? "Running" : cell.kind === "sql" ? "Run Query" : "Run Cell"}
              onClick={handleRunCell}
              disabled={isRunning}
              className="flex items-center justify-center cursor-pointer w-5.5 h-5.5 rounded-md text-[#8f949f] hover:bg-white/[0.08] hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 5.14v14l11-7-11-7z" /></svg>
            </button>
          )}
          <button
            type="button"
            title="Move Up"
            onClick={() => moveCellUp(selectedNotebookId, cell.id)}
            disabled={index === 0}
            className="flex items-center justify-center cursor-pointer w-5.5 h-5.5 rounded-md text-[#8f949f] hover:bg-white/[0.08] hover:text-white transition disabled:opacity-30"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="18 15 12 9 6 15"></polyline></svg>
          </button>
          <button
            type="button"
            title="Move Down"
            onClick={() => moveCellDown(selectedNotebookId, cell.id)}
            disabled={index === cellsCount - 1}
            className="flex items-center justify-center cursor-pointer w-5.5 h-5.5 rounded-md text-[#8f949f] hover:bg-white/[0.08] hover:text-white transition disabled:opacity-30"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <button
            type="button"
            title="Delete Cell"
            onClick={() => deleteCell(selectedNotebookId, cell.id)}
            className="flex items-center justify-center cursor-pointer w-5.5 h-5.5 rounded-md text-[#8f949f] hover:bg-white/[0.08] hover:text-white transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
          <button
            type="button"
            title="Add Code Below"
            onClick={() => addCellAfter(selectedNotebookId, cell.id, "code")}
            className="flex items-center justify-center cursor-pointer w-5.5 h-5.5 rounded-md text-[#8f949f] hover:bg-white/[0.08] hover:text-white transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
          </button>
          <button
            type="button"
            title="Add SQL Below"
            onClick={() => addCellAfter(selectedNotebookId, cell.id, "sql")}
            className="flex items-center justify-center cursor-pointer w-5.5 h-5.5 rounded-md text-[#8f949f] hover:bg-white/[0.08] hover:text-white transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><ellipse cx="12" cy="5" rx="7" ry="3"></ellipse><path d="M5 5v6c0 1.66 3.13 3 7 3s7-1.34 7-3V5"></path><path d="M5 11v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6"></path></svg>
          </button>
          <button
            type="button"
            title="Add Text Below"
            onClick={() => addCellAfter(selectedNotebookId, cell.id, "markdown")}
            className="flex items-center justify-center cursor-pointer w-5.5 h-5.5 rounded-md text-[#8f949f] hover:bg-white/[0.08] hover:text-white transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><line x1="21" y1="15" x2="15" y2="15"></line><line x1="18" y1="12" x2="18" y2="18"></line><line x1="3" y1="15" x2="9" y2="15"></line><line x1="6" y1="12" x2="6" y2="18"></line></svg>
          </button>
          </div>
        </div>
      </div>
    </article>
  );
});

export default memo(function NotebookView() {
  const selectedFileId = useInterfaceStore((state) => state.selectedFileId);
  const cells = useInterfaceStore(useShallow((state) => state.notebooks[selectedFileId]?.cells ?? []));
  const addCell = useInterfaceStore((state) => state.addCell);

  const notebookId = useInterfaceStore((state) => state.notebooks[selectedFileId]?.id ?? getDefaultNotebook().id);
  const notebookSummary = useInterfaceStore((state) => state.notebooks[selectedFileId]?.summary ?? getDefaultNotebook().summary);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#121212] relative z-0">
      <section className="dense-scroll min-h-0 overflow-auto px-4 pb-6 grow sm:px-5">
        <div className="mx-auto max-w-[1120px] space-y-4 pt-2">
          <Suspense fallback={<div className="h-[52px] w-full shrink-0" />}><Header /></Suspense>
          <div className="mb-2 px-1">
            <p className="max-w-3xl text-[12px] leading-6 text-[#8d909a]">{notebookSummary}</p>
          </div>

          {cells.map((cell, index) => (
            <Cell
              key={cell.id}
              cell={cell}
              index={index}
              cellsCount={cells.length}
              selectedNotebookId={notebookId}
            />
          ))}
          
          <div className="flex items-center justify-center gap-2 pt-4 pb-3">
            <button
              type="button"
              onClick={() => addCell(notebookId, "code")}
              className="flex items-center cursor-pointer gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-medium uppercase tracking-[0.1em] text-[#8f939d] bg-white/[0.03] hover:bg-white/[0.08] hover:text-white transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Code
            </button>
            <button
              type="button"
              onClick={() => addCell(notebookId, "sql")}
              className="flex items-center cursor-pointer gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-medium uppercase tracking-[0.1em] text-[#8f939d] bg-white/[0.03] hover:bg-white/[0.08] hover:text-white transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><ellipse cx="12" cy="5" rx="7" ry="3"></ellipse><path d="M5 5v6c0 1.66 3.13 3 7 3s7-1.34 7-3V5"></path><path d="M5 11v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6"></path></svg>
              SQL
            </button>
            <button
              type="button"
              onClick={() => addCell(notebookId, "markdown")}
              className="flex items-center cursor-pointer gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-medium uppercase tracking-[0.1em] text-[#8f939d] bg-white/[0.03] hover:bg-white/[0.08] hover:text-white transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Text
            </button>
          </div>
        </div>
      </section>
    </div>
  );
});
