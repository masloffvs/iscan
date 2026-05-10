import type { JSX } from "react";

import type {
  RemoteResolvedSettingValue,
  RemoteSettingSnapshot,
} from "../api/client";
import {
  ApplicationActionButton,
  ApplicationAlert,
  ApplicationEmptyState,
  ApplicationPanel,
} from "./application-layout.tsx";
import {
  formatDraftValue,
  type SettingsDraftValue,
} from "./settings-model";

type SettingsListPanelProps = {
  filteredSettings: RemoteSettingSnapshot[];
  drafts: Record<string, SettingsDraftValue>;
  busySettingId: string | null;
  actionErrors: Record<string, string>;
  isLoading: boolean;
  onSave: (snapshot: RemoteSettingSnapshot) => Promise<void> | void;
  onReset: (snapshot: RemoteSettingSnapshot) => Promise<void> | void;
  onDraftChange: (settingId: string, value: SettingsDraftValue) => void;
};

function getSourceBadgeClassName(source: RemoteResolvedSettingValue["source"] | undefined): string {
  if (source === "stored") {
    return "bg-sky-400/10 text-sky-100";
  }

  if (source === "invalid-stored-default") {
    return "bg-amber-400/10 text-amber-100";
  }

  return "bg-white/[0.04] text-[#c7c7ce]";
}

function renderSettingEditor(
  snapshot: RemoteSettingSnapshot,
  draftValue: SettingsDraftValue,
  onChange: (value: SettingsDraftValue) => void,
): JSX.Element {
  const { editor, secret } = snapshot.definition;
  const inputClassName = "w-full rounded-[10px] bg-black/20 px-3 py-2 font-mono text-[11px] text-[#ececf2] outline-none transition focus:bg-black/30";

  if (editor.kind === "boolean") {
    return (
      <label className="flex items-center justify-between rounded-[10px] bg-black/15 px-3 py-2 font-mono text-[10px] text-[#ececf2]">
        <span>enabled</span>
        <input
          type="checkbox"
          checked={draftValue === true}
          onChange={(event) => onChange(event.target.checked)}
          className="h-3.5 w-3.5 accent-[#d7dae3]"
        />
      </label>
    );
  }

  if (editor.kind === "enum") {
    return (
      <select
        value={String(draftValue)}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      >
        {(editor.enumValues ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (editor.kind === "string[]" || editor.kind === "json" || editor.multiline) {
    return (
      <textarea
        value={String(draftValue)}
        onChange={(event) => onChange(event.target.value)}
        rows={editor.kind === "json" ? 6 : 4}
        placeholder={editor.placeholder}
        spellCheck={false}
        className={`${inputClassName} min-h-[96px] resize-y`}
      />
    );
  }

  return (
    <input
      type={secret ? "password" : editor.kind === "number" ? "number" : "text"}
      value={String(draftValue)}
      onChange={(event) => onChange(event.target.value)}
      placeholder={editor.placeholder}
      spellCheck={false}
      className={inputClassName}
    />
  );
}

export default function SettingsListPanel({
  filteredSettings,
  drafts,
  busySettingId,
  actionErrors,
  isLoading,
  onSave,
  onReset,
  onDraftChange,
}: SettingsListPanelProps) {
  return (
    <ApplicationPanel title="Settings">
      {isLoading ? (
        <div className="space-y-0">
          {[0, 1, 2].map((index) => (
            <div key={index} className="animate-pulse py-3 first:pt-0">
              <div className="h-3 w-40 rounded bg-white/10" />
              <div className="mt-2 h-2.5 w-3/4 rounded bg-white/[0.06]" />
              <div className="mt-3 h-9 rounded-[10px] bg-black/20" />
            </div>
          ))}
        </div>
      ) : filteredSettings.length === 0 ? (
        <ApplicationEmptyState text="No settings match the current filters." />
      ) : (
        <div className="space-y-0">
          {filteredSettings.map((snapshot) => {
            const draftValue = drafts[snapshot.definition.id] ?? formatDraftValue(snapshot);
            const isBusy = busySettingId === snapshot.definition.id;
            const source = snapshot.value?.source;
            const isDirty = draftValue !== formatDraftValue(snapshot);

            return (
              <article key={snapshot.definition.id} className="py-3 first:pt-0">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="text-[12px] font-medium text-[#ececf2]">{snapshot.definition.label}</h3>
                      <span className="rounded-[8px] bg-white/[0.04] px-2 py-0.5 font-mono text-[9px] text-[#cfd0d8]">
                        {snapshot.definition.id}
                      </span>
                      <span className={`rounded-[8px] px-2 py-0.5 font-mono text-[9px] ${getSourceBadgeClassName(source)}`}>
                        {source ?? (snapshot.missing ? "missing" : "default")}
                      </span>
                      {snapshot.definition.secret ? (
                        <span className="rounded-[8px] bg-amber-400/10 px-2 py-0.5 font-mono text-[9px] text-amber-100">secret</span>
                      ) : null}
                    </div>

                    {snapshot.definition.description ? (
                      <p className="mt-1 max-w-3xl text-[10px] leading-5 text-[#8f9098]">{snapshot.definition.description}</p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-[#8d8d96]">
                      <span>{snapshot.definition.groupLabel ?? "ungrouped"}</span>
                      <span>{snapshot.definition.editor.kind}</span>
                      <span>{snapshot.definition.hasDefault ? "default available" : "stored only"}</span>
                      {snapshot.value?.updatedAt ? <span>updated {new Date(snapshot.value.updatedAt).toLocaleString()}</span> : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <ApplicationActionButton
                      onClick={() => void onReset(snapshot)}
                      disabled={isBusy}
                      className="bg-white/[0.05] text-[#cfd0d8] disabled:opacity-60"
                    >
                      Reset
                    </ApplicationActionButton>
                    <ApplicationActionButton
                      onClick={() => void onSave(snapshot)}
                      disabled={isBusy || !isDirty}
                      className="disabled:opacity-50"
                    >
                      {isBusy ? "Saving" : "Save"}
                    </ApplicationActionButton>
                  </div>
                </div>

                <div className="mt-3">
                  {renderSettingEditor(snapshot, draftValue, (value) => onDraftChange(snapshot.definition.id, value))}
                </div>

                {snapshot.value?.validationError ? (
                  <div className="mt-2"><ApplicationAlert tone="warning">{snapshot.value.validationError}</ApplicationAlert></div>
                ) : null}

                {actionErrors[snapshot.definition.id] ? (
                  <div className="mt-2"><ApplicationAlert>{actionErrors[snapshot.definition.id]}</ApplicationAlert></div>
                ) : null}

                {snapshot.definition.defaultSummary && !snapshot.definition.secret ? (
                  <p className="mt-2 font-mono text-[10px] text-[#8d8d96]">default {snapshot.definition.defaultSummary}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </ApplicationPanel>
  );
}