import { useState, useEffect, type ReactNode } from "react";
import React, { Suspense } from "react";
import { type BpkgCommandResultValue, type BpkgResultTabId } from "../types";
import { countOutputLines, hasMeaningfulText } from "../utils";
import { isNmapParsedResponseValue } from "../utils";

const NmapParsedRenderer = React.lazy(() => import("./NmapParsedRenderer"));
const JsonRenderer = React.lazy(() => import("./JsonRenderer"));
const CommandStreamPanel = React.lazy(() => import("./CommandStreamPanel"));
const StructuredCellOutputRoot = React.lazy(() => import("../index"));

function renderBpkgParsedValue(
  value: unknown,
  stdout: string | undefined,
  onTableSelectionCopyTextChange?: (tableId: string, text: string | null) => void,
): ReactNode {
  if (isNmapParsedResponseValue(value)) {
    return <NmapParsedRenderer value={value} stdout={stdout} />;
  }

  return <StructuredCellOutputRoot value={value} onTableSelectionCopyTextChange={onTableSelectionCopyTextChange} />;
}

export default function BpkgCommandResultRenderer({
  value,
  onTableSelectionCopyTextChange,
}: {
  value: BpkgCommandResultValue;
  onTableSelectionCopyTextChange?: (tableId: string, text: string | null) => void;
}) {
  const hasParsed = value.parsed !== undefined;
  const hasStdout = hasMeaningfulText(value.stdout);
  const hasStderr = hasMeaningfulText(value.stderr);
  const defaultTab: BpkgResultTabId = hasParsed
    ? "parsed"
    : hasStdout
      ? "stdout"
      : hasStderr
        ? "stderr"
        : "raw";
  const [activeTab, setActiveTab] = useState<BpkgResultTabId>(defaultTab);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab, value.bindingId, value.boxId, value.commandString, value.exitCode, value.packageId]);

  const tabs: { id: BpkgResultTabId; label: string }[] = [
    ...(hasParsed ? [{ id: "parsed" as const, label: "Parsed" }] : []),
    { id: "stdout", label: "Stdout" },
    { id: "stderr", label: "Stderr" },
    { id: "raw", label: "Raw" },
  ];
  const commandLabel = value.commandString || value.command.join(" ");
  const statusLabel = value.exitCode === 0 ? "Success" : `Exit ${value.exitCode}`;
  const statusClassName = value.exitCode === 0 ? "text-emerald-200" : "text-rose-200";

  let tabContent: ReactNode = null;
  switch (activeTab) {
    case "parsed":
      tabContent = value.parsed !== undefined
        ? renderBpkgParsedValue(value.parsed, value.stdout, onTableSelectionCopyTextChange)
        : null;
      break;
    case "stdout":
      tabContent = <CommandStreamPanel emptyLabel="No stdout captured." text={value.stdout} tone="output" />;
      break;
    case "stderr":
      tabContent = <CommandStreamPanel emptyLabel="No stderr captured." text={value.stderr} tone="error" />;
      break;
    case "raw":
      tabContent = <JsonRenderer value={value as unknown as Record<string, unknown>} />;
      break;
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#8c8c94]">
          Command
        </div>
        <pre className="dense-scroll overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[#f5d08a]">
          {commandLabel}
        </pre>
      </div>

      <div className="flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition ${isActive ? "bg-white/[0.08] text-white" : "text-[#a0a0a8] hover:text-white"}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <Suspense fallback={<div className="text-[11px] text-[#7b7b84]">Loading tab...</div>}>
        {tabContent}
      </Suspense>

      <details className="group space-y-2 pt-1">
        <summary className="cursor-pointer list-none text-[10px] uppercase tracking-[0.16em] text-[#6f6f78] transition hover:text-[#a0a0a8] [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <span className="transition group-open:rotate-90">▸</span>
            <span>Run details</span>
          </span>
        </summary>

        <div className="space-y-2 pl-5">
          <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-[#7b7b84]">
            <span>{value.command.length} argv</span>
            <span>{countOutputLines(value.stdout)} stdout lines</span>
            <span>{countOutputLines(value.stderr)} stderr lines</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.16em] text-[#8c8c94]">
            <span className={`font-medium ${statusClassName}`}>
              {statusLabel}
            </span>
            <span className="text-[#2c2c31]">•</span>
            <span className="text-[#d6d6db]">
              Box {value.boxId}
            </span>
            {value.packageId && (
              <>
                <span className="text-[#2c2c31]">•</span>
                <span className="text-[#a7c7ff]">
                  Package {value.packageId}
                </span>
              </>
            )}
            {value.bindingId && (
              <>
                <span className="text-[#2c2c31]">•</span>
                <span className="text-[#f5d08a]">
                  Binding {value.bindingId}
                </span>
              </>
            )}
            {typeof value.transpiled?.cwd === "string" && value.transpiled.cwd.length > 0 && (
              <>
                <span className="text-[#2c2c31]">•</span>
                <span>
                  Cwd {value.transpiled.cwd}
                </span>
              </>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}
