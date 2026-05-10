import { type NmapParsedResponseValue } from "../types";
import { isObjectRecord, toRecordArray, toStringArray, hasMeaningfulText } from "../utils";
import {
  parseNmapPortRowsFromParsed,
  parseNmapPortRowsFromStdout,
  isUsefulNmapNote,
} from "../nmapUtils";

export default function NmapParsedRenderer({
  value,
  stdout,
}: {
  value: NmapParsedResponseValue;
  stdout?: string;
}) {
  const hosts = toRecordArray(value.report.hosts);
  const parsedPortRows = parseNmapPortRowsFromParsed(value);
  const fallbackPortRows = parsedPortRows.length === 0 && hasMeaningfulText(stdout ?? "")
    ? parseNmapPortRowsFromStdout(stdout ?? "", value.target)
    : [];
  const portRows = parsedPortRows.length > 0 ? parsedPortRows : fallbackPortRows;
  const topLevelNotes = toStringArray(value.report.notes);
  const hostNotes = hosts.flatMap((host) => toStringArray(host.notes));
  const notes = [...topLevelNotes, ...hostNotes].filter(isUsefulNmapNote).slice(0, 6);
  const summaryText = isObjectRecord(value.report.summary) && typeof value.report.summary.raw === "string"
    ? value.report.summary.raw
    : undefined;
  const hostCount = hosts.length > 0
    ? hosts.length
    : portRows.length > 0
      ? new Set(portRows.map((row) => row.host)).size
      : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-[#7b7b84]">
        <span>Target {value.target}</span>
        {typeof value.format === "string" && value.format.length > 0 && <span>Format {value.format}</span>}
        <span>{hostCount} hosts</span>
        <span>{portRows.length} ports</span>
      </div>

      {summaryText && (
        <div className="text-[11px] leading-relaxed text-[#a0a0a8]">{summaryText}</div>
      )}

      <div className="dense-scroll overflow-x-auto">
        <table className="min-w-full border-collapse font-mono text-[11px] leading-relaxed text-[#e4e4e7]">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-[10px] font-medium uppercase tracking-[0.12em] text-[#8c8c94]">Host</th>
              <th className="px-2 py-1 text-left text-[10px] font-medium uppercase tracking-[0.12em] text-[#8c8c94]">Port</th>
              <th className="px-2 py-1 text-left text-[10px] font-medium uppercase tracking-[0.12em] text-[#8c8c94]">State</th>
              <th className="px-2 py-1 text-left text-[10px] font-medium uppercase tracking-[0.12em] text-[#8c8c94]">Service</th>
              <th className="px-2 py-1 text-left text-[10px] font-medium uppercase tracking-[0.12em] text-[#8c8c94]">Found</th>
            </tr>
          </thead>
          <tbody>
            {portRows.length > 0 ? portRows.map((row) => (
              <tr key={row.id} className="align-top odd:bg-white/[0.01] even:bg-transparent">
                <td className="px-2 py-1 text-[#d6d6db]">{row.host}</td>
                <td className="px-2 py-1 text-[#f5d08a]">{row.port}</td>
                <td className="px-2 py-1">{row.state}</td>
                <td className="px-2 py-1 text-[#a7c7ff]">{row.service}</td>
                <td className="px-2 py-1 text-[#a0a0a8]">{row.findings}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className="px-2 py-2 text-[#7b7b84]">
                  No parsed ports found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {notes.length > 0 && (
        <div className="space-y-1">
          {notes.map((note, index) => (
            <div key={`${note}:${index}`} className="text-[11px] leading-relaxed text-[#7b7b84]">
              {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
