import {
  Suspense,
  lazy,
  memo,
  useMemo,
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
    <article className="grid grid-cols-[48px_1fr_32px] gap-3 group relative">
      <div className="pt-2.5 text-right">
        <button
          type="button"
          onClick={() => focusCell(cell.id)}
          className="font-mono cursor-pointer text-[10px] text-[#71717a] hover:text-[#d6d6db] transition"
        >
          {isExecutableCell
            ? `In [${isRunning ? "*" : executionCount ?? " "}]`
            : `# ${String(index + 1).padStart(2, "0")}`}
        </button>
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
        className={`rounded-[14px] px-4 py-3 outline-none transition ${
          isRunning
            ? "bg-white/[0.035]"
            : isActive
              ? "bg-white/[0.04]"
              : "bg-white/[0.015] hover:bg-white/[0.03]"
        }`}
      >
        {isExecutableCell && (
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[10px] uppercase tracking-[0.2em] text-[#71717a]">{cell.title}</p>
            <div className="flex items-center gap-2">
              {cellLanguage && <span className="font-mono text-[9px] text-[#71717a]">{cellLanguage}</span>}
            </div>
          </div>
        )}

        {cell.kind === "markdown" ? (
          <textarea
            value={cell.source.join("\n")}
            onChange={(e) => updateCellSource(selectedNotebookId, cell.id, e.target.value.split("\n"))}
            className="w-full cursor-text resize-none overflow-hidden bg-transparent font-sans text-[13px] leading-relaxed text-[#d6d6db] outline-none"
            rows={cell.source.length || 1}
          />
        ) : (
          <div className="mt-2 text-[11px] font-mono">
            {isActive ? (
              <Suspense
                fallback={(
                  <textarea
                    value={sourceText}
                    onChange={(event) => updateCellSource(selectedNotebookId, cell.id, event.target.value.split("\n"))}
                    className="w-full cursor-text resize-none overflow-hidden rounded-[10px] bg-black/20 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[#d6d6db] outline-none"
                    rows={cell.source.length || 1}
                  />
                )}
              >
                <CodeCellEditor
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
              <pre className="min-h-[40px] overflow-x-auto whitespace-pre-wrap rounded-[10px] bg-black/20 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[#d6d6db]">
                {sourceText || " "}
              </pre>
            )}
          </div>
        )}

        {cell.output && cell.output.length > 0 && (
          <div className="mt-3 grid grid-cols-[48px_1fr] gap-3">
            <div className="pt-1 text-right font-mono text-[10px] text-[#71717a]">
              Out[{executionCount ?? " "}]
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
              className="relative overflow-x-auto rounded-[10px] bg-black/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[#e4e4e7] outline-none focus-visible:ring-1 focus-visible:ring-white/10"
            >
              {copiedFormat && (
                <div className="pointer-events-none absolute right-2 top-2 z-10 flex flex-wrap items-center justify-end gap-1.5">
                  <span className="rounded-md bg-[#0f0f12]/90 px-2 py-1 text-[9px] font-medium uppercase tracking-[0.12em] text-[#8eb7ff]">
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

        {isRunning && (
          <div className="mt-3 pl-[51px]">
            <div className="relative h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
              <div className="notebook-progress-bar notebook-progress-bar-primary absolute inset-y-0 w-[38%] bg-[#8eb7ff]" />
              <div className="notebook-progress-bar notebook-progress-bar-secondary absolute inset-y-0 w-[24%] bg-white/60" />
            </div>
          </div>
        )}
      </div>

      <div className="pt-2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1 items-center">
        {isExecutableCell && (
          <button
            type="button"
            title={isRunning ? "Running" : cell.kind === "sql" ? "Run Query" : "Run Cell"}
            onClick={handleRunCell}
            disabled={isRunning}
            className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-md text-[#a0a0a8] hover:bg-white/[0.08] hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 5.14v14l11-7-11-7z" /></svg>
          </button>
        )}
        <button
          type="button"
          title="Move Up"
          onClick={() => moveCellUp(selectedNotebookId, cell.id)}
          disabled={index === 0}
          className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-md text-[#a0a0a8] hover:bg-white/[0.08] hover:text-white transition disabled:opacity-30"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="18 15 12 9 6 15"></polyline></svg>
        </button>
        <button
          type="button"
          title="Move Down"
          onClick={() => moveCellDown(selectedNotebookId, cell.id)}
          disabled={index === cellsCount - 1}
          className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-md text-[#a0a0a8] hover:bg-white/[0.08] hover:text-white transition disabled:opacity-30"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <button
          type="button"
          title="Delete Cell"
          onClick={() => deleteCell(selectedNotebookId, cell.id)}
          className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-md text-[#a0a0a8] hover:bg-white/[0.08] hover:text-white transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
        <button
          type="button"
          title="Add Code Below"
          onClick={() => addCellAfter(selectedNotebookId, cell.id, "code")}
          className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-md text-[#a0a0a8] hover:bg-white/[0.08] hover:text-white transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
        </button>
        <button
          type="button"
          title="Add SQL Below"
          onClick={() => addCellAfter(selectedNotebookId, cell.id, "sql")}
          className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-md text-[#a0a0a8] hover:bg-white/[0.08] hover:text-white transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><ellipse cx="12" cy="5" rx="7" ry="3"></ellipse><path d="M5 5v6c0 1.66 3.13 3 7 3s7-1.34 7-3V5"></path><path d="M5 11v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6"></path></svg>
        </button>
        <button
          type="button"
          title="Add Text Below"
          onClick={() => addCellAfter(selectedNotebookId, cell.id, "markdown")}
          className="flex items-center justify-center cursor-pointer w-6 h-6 rounded-md text-[#a0a0a8] hover:bg-white/[0.08] hover:text-white transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><line x1="21" y1="15" x2="15" y2="15"></line><line x1="18" y1="12" x2="18" y2="18"></line><line x1="3" y1="15" x2="9" y2="15"></line><line x1="6" y1="12" x2="6" y2="18"></line></svg>
        </button>
      </div>
    </article>
  );
});

export default function NotebookView() {
  const selectedFileId = useInterfaceStore((state) => state.selectedFileId);
  const cells = useInterfaceStore(useShallow((state) => state.notebooks[selectedFileId]?.cells ?? []));
  const addCell = useInterfaceStore((state) => state.addCell);

  const notebookId = useInterfaceStore((state) => state.notebooks[selectedFileId]?.id ?? getDefaultNotebook().id);
  const notebookSummary = useInterfaceStore((state) => state.notebooks[selectedFileId]?.summary ?? getDefaultNotebook().summary);
  
  const isbFiles = useInterfaceStore((state) => state.isbFiles);
  const selectedFile = useMemo(() => isbFiles.find((file) => file.relativePath === notebookId), [isbFiles, notebookId]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#171717] relative z-0">
      <Suspense fallback={<div className="h-[60px] bg-[#0d0d0d] w-full shrink-0" />}><Header /></Suspense>

      <section className="dense-scroll min-h-0 overflow-auto px-6 pb-8 grow">
        <div className="mx-auto max-w-5xl space-y-3 pt-16">
          <div className="px-5 mb-6">
            <p className="text-[11px] leading-relaxed text-[#9a9aa2]">{notebookSummary}</p>
            {selectedFile && (
              <p className="mt-1.5 text-[9px] uppercase tracking-[0.2em] text-[#68686e]">
                disk-backed / {selectedFile.trusted ? "trusted" : "untrusted"} / {selectedFile.cellCount} cells
              </p>
            )}
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
          
          <div className="flex items-center justify-center gap-3 pt-6 pb-4">
            <button
              type="button"
              onClick={() => addCell(notebookId, "code")}
              className="flex items-center cursor-pointer gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-medium uppercase tracking-[0.1em] text-[#a0a0a8] bg-white/[0.03] hover:bg-white/[0.08] hover:text-white transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Code
            </button>
            <button
              type="button"
              onClick={() => addCell(notebookId, "sql")}
              className="flex items-center cursor-pointer gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-medium uppercase tracking-[0.1em] text-[#a0a0a8] bg-white/[0.03] hover:bg-white/[0.08] hover:text-white transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><ellipse cx="12" cy="5" rx="7" ry="3"></ellipse><path d="M5 5v6c0 1.66 3.13 3 7 3s7-1.34 7-3V5"></path><path d="M5 11v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6"></path></svg>
              SQL
            </button>
            <button
              type="button"
              onClick={() => addCell(notebookId, "markdown")}
              className="flex items-center cursor-pointer gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-medium uppercase tracking-[0.1em] text-[#a0a0a8] bg-white/[0.03] hover:bg-white/[0.08] hover:text-white transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Text
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
