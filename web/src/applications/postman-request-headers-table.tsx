import type { RemoteHttpClientFieldEntry } from "../api/client";
import workbookTheme from "../theme.tsx";
import {
  parseReadableHeaderValue,
  titleCaseHeaderName,
} from "./postman-header-parsing.ts";

function renderParsedHeaderValue(headerName: string, value: string) {
  const parsed = headerName.trim().length > 0
    ? parseReadableHeaderValue(headerName, value)
    : null;

  if (!parsed) {
    return <span className={workbookTheme.text.quiet}>No structured parser</span>;
  }

  return (
    <div className="space-y-1.5">
      <div className={`font-mono text-[10px] ${workbookTheme.text.primary}`}>{parsed.summary}</div>
      {parsed.details.length > 0 ? (
        <div className={`space-y-1 ${workbookTheme.text.bodyDim}`}>
          {parsed.details.map((detail) => (
            <div key={detail}>{detail}</div>
          ))}
        </div>
      ) : null}
      {parsed.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {parsed.tags.map((tag) => (
            <span key={tag} className={`rounded-[8px] ${workbookTheme.surface.softAccent} px-2 py-0.5 font-mono text-[9px] ${workbookTheme.text.tag}`}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function PostmanRequestHeadersTable({
  entries,
  onChange,
}: {
  entries: RemoteHttpClientFieldEntry[];
  onChange: (entries: RemoteHttpClientFieldEntry[]) => void;
}) {
  return (
    <div>
      <div className={`overflow-auto rounded-[14px] ${workbookTheme.surface.panel}`}>
        <table className="w-full min-w-[980px] table-fixed border-collapse">
          <thead>
            <tr className={`border-b ${workbookTheme.border.default}`}>
              <th className={`w-[56px] px-3 py-2 text-left text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>On</th>
              <th className={`w-[220px] px-3 py-2 text-left text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Header</th>
              <th className={`w-[300px] px-3 py-2 text-left text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Value</th>
              <th className={`px-3 py-2 text-left text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Parsed</th>
              <th className={`w-[56px] px-3 py-2 text-left text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Del</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className={`border-t ${workbookTheme.border.subtle} align-top first:border-t-0`}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(event) => onChange(entries.map((item) => item.id === entry.id ? { ...item, enabled: event.target.checked } : item))}
                    className="h-3.5 w-3.5 accent-white/80"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={entry.key}
                    onChange={(event) => onChange(entries.map((item) => item.id === entry.id ? { ...item, key: event.target.value } : item))}
                    placeholder="Header"
                    className={`w-full bg-transparent font-mono text-[11px] ${workbookTheme.text.canvas} outline-none ${workbookTheme.text.placeholder}`}
                  />
                  {entry.key.trim().length > 0 ? (
                    <div className={`mt-1 text-[9px] uppercase tracking-[0.14em] ${workbookTheme.text.quiet}`}>{titleCaseHeaderName(entry.key.trim())}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <textarea
                    value={entry.value}
                    onChange={(event) => onChange(entries.map((item) => item.id === entry.id ? { ...item, value: event.target.value } : item))}
                    placeholder="Value"
                    className={`min-h-[68px] w-full resize-y bg-transparent font-mono text-[11px] leading-relaxed ${workbookTheme.text.canvas} outline-none ${workbookTheme.text.placeholder}`}
                    spellCheck={false}
                    rows={entry.value.includes("\n") ? 4 : 3}
                  />
                </td>
                <td className={`px-3 py-2 text-[10px] leading-relaxed ${workbookTheme.text.bodySoft}`}>
                  {renderParsedHeaderValue(entry.key, entry.value)}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onChange(entries.filter((item) => item.id !== entry.id))}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] ${workbookTheme.text.control} transition ${workbookTheme.interaction.buttonSubtle} hover:text-white`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => onChange([...entries, {
          id: crypto.randomUUID(),
          key: "",
          value: "",
          enabled: true,
        }])}
        className={`mt-3 rounded-[12px] ${workbookTheme.surface.softAccent} px-3 py-1.5 text-[10px] font-medium ${workbookTheme.text.bodySoft} transition ${workbookTheme.interaction.hoverStrong}`}
      >
        Add row
      </button>
    </div>
  );
}