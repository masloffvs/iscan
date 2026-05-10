import { buildReadableHeaderRows } from "./postman-header-parsing.ts";
import workbookTheme from "../theme.tsx";

export default function PostmanResponseHeadersTable({ headers }: { headers: Record<string, string> }) {
  const rows = buildReadableHeaderRows(headers);

  return (
    <div className={`overflow-auto rounded-[14px] ${workbookTheme.surface.panel}`}>
      <table className="w-full min-w-[980px] table-fixed border-collapse">
        <thead>
          <tr className={`border-b ${workbookTheme.border.default}`}>
            <th className={`w-[190px] px-3 py-2 text-left text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Header</th>
            <th className={`w-[380px] px-3 py-2 text-left text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Value</th>
            <th className={`px-3 py-2 text-left text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`}>Parsed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={`border-t ${workbookTheme.border.subtle} align-top first:border-t-0`}>
              <td className={`px-3 py-2 font-mono text-[10px] ${workbookTheme.text.tableHeader}`}>{row.headerLabel}</td>
              <td className={`px-3 py-2 font-mono text-[10px] leading-relaxed ${workbookTheme.text.bodyMuted} whitespace-pre-wrap break-all`}>{row.rawValue}</td>
              <td className={`px-3 py-2 text-[10px] leading-relaxed ${workbookTheme.text.bodySoft}`}>
                {row.parsed ? (
                  <div className="space-y-1.5">
                    <div className={`font-mono text-[10px] ${workbookTheme.text.primary}`}>{row.parsed.summary}</div>
                    {row.parsed.details.length > 0 ? (
                      <div className={`space-y-1 ${workbookTheme.text.bodyDim}`}>
                        {row.parsed.details.map((detail) => (
                          <div key={detail}>{detail}</div>
                        ))}
                      </div>
                    ) : null}
                    {row.parsed.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {row.parsed.tags.map((tag) => (
                          <span key={tag} className={`rounded-[8px] ${workbookTheme.surface.softAccent} px-2 py-0.5 font-mono text-[9px] ${workbookTheme.text.tag}`}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <span className={workbookTheme.text.quiet}>No structured parser</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}