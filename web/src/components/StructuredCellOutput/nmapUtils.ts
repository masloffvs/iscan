import { type NmapParsedResponseValue, type NmapParsedPortRow } from "./types";
import { isObjectRecord, toRecordArray } from "./utils";

export function formatNmapHostLabel(host: Record<string, unknown>): string {
  if (typeof host.target === "string" && host.target.length > 0) {
    return host.target;
  }
  if (typeof host.hostname === "string" && host.hostname.length > 0) {
    if (typeof host.address === "string" && host.address.length > 0) {
      return `${host.hostname} (${host.address})`;
    }
    return host.hostname;
  }
  if (typeof host.address === "string" && host.address.length > 0) {
    return host.address;
  }
  return "unknown host";
}

export function formatNmapPortLabel(port: Record<string, unknown>): string {
  const portValue = typeof port.port === "number"
    ? String(port.port)
    : typeof port.port === "string"
      ? port.port
      : "?";
  const protocol = typeof port.protocol === "string" && port.protocol.length > 0 ? port.protocol : "tcp";
  return `${portValue}/${protocol}`;
}

export function formatNmapServiceLabel(port: Record<string, unknown>): string {
  if (typeof port.service === "string" && port.service.length > 0) {
    return port.service;
  }
  if (isObjectRecord(port.service)) {
    const parts = [
      typeof port.service.name === "string" ? port.service.name : undefined,
      typeof port.service.product === "string" ? port.service.product : undefined,
      typeof port.service.version === "string" ? port.service.version : undefined,
      typeof port.service.extraInfo === "string" ? port.service.extraInfo : undefined,
    ].filter((entry): entry is string => Boolean(entry && entry.length > 0));
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }
  return "-";
}

export function formatNmapFindingDetails(host: Record<string, unknown>, port: Record<string, unknown>): string {
  const findings: string[] = [];
  if (typeof port.version === "string" && port.version.length > 0) {
    findings.push(port.version);
  }
  if (typeof port.reason === "string" && port.reason.length > 0) {
    findings.push(`reason: ${port.reason}`);
  }
  if (typeof host.serviceInfo === "string" && host.serviceInfo.length > 0) {
    findings.push(host.serviceInfo);
  }
  const scripts = Array.isArray(port.scripts) ? port.scripts : [];
  for (const script of scripts) {
    if (typeof script === "string") {
      findings.push(script);
      continue;
    }
    if (isObjectRecord(script) && typeof script.id === "string") {
      findings.push(typeof script.output === "string" && script.output.length > 0
        ? `${script.id}: ${script.output}`
        : script.id);
    }
  }
  return findings.join(" • ") || "-";
}

export function parseNmapPortRowsFromParsed(value: NmapParsedResponseValue): NmapParsedPortRow[] {
  const hosts = toRecordArray(value.report.hosts);
  return hosts.flatMap((host) => {
    const hostLabel = formatNmapHostLabel(host);
    return toRecordArray(host.ports).map((port, index) => ({
      id: `${hostLabel}:${formatNmapPortLabel(port)}:${index}`,
      host: hostLabel,
      port: formatNmapPortLabel(port),
      state: typeof port.state === "string" && port.state.length > 0 ? port.state : "unknown",
      service: formatNmapServiceLabel(port),
      findings: formatNmapFindingDetails(host, port),
    }));
  });
}

export function parseNmapStdoutHostLabel(stdout: string, fallbackTarget: string): string {
  const reportLine = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith("Nmap scan report for "));
  if (reportLine) {
    return reportLine.slice("Nmap scan report for ".length).trim() || fallbackTarget;
  }
  return fallbackTarget;
}

export function parseNmapPortRowsFromStdout(stdout: string, fallbackTarget: string): NmapParsedPortRow[] {
  const hostLabel = parseNmapStdoutHostLabel(stdout, fallbackTarget);
  const rows: NmapParsedPortRow[] = [];
  let parsingPorts = false;
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      parsingPorts = false;
      continue;
    }
    if (/^PORT\s+STATE\s+SERVICE/iu.test(trimmed)) {
      parsingPorts = true;
      continue;
    }
    if (!parsingPorts) {
      continue;
    }
    if (/^[|]/u.test(trimmed)) {
      const lastRow = rows.at(-1);
      if (lastRow) {
        const nextFinding = trimmed.replace(/^[|_ ]+/u, "").trim();
        if (nextFinding.length > 0) {
          lastRow.findings = lastRow.findings === "-"
            ? nextFinding
            : `${lastRow.findings} • ${nextFinding}`;
        }
      }
      continue;
    }
    const portMatch = trimmed.match(/^(\d+)\/([a-z0-9?]+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/iu);
    if (!portMatch) {
      parsingPorts = false;
      continue;
    }
    rows.push({
      id: `${hostLabel}:${portMatch[1]}/${portMatch[2]}:${rows.length}`,
      host: hostLabel,
      port: `${portMatch[1]}/${portMatch[2]}`,
      state: portMatch[3] ?? "unknown",
      service: portMatch[4] ?? "unknown",
      findings: portMatch[5]?.trim() || "-",
    });
  }
  return rows;
}

export function isUsefulNmapNote(note: string): boolean {
  const normalized = note.trim();
  if (normalized.length === 0) {
    return false;
  }
  return !/^Starting Nmap\b/iu.test(normalized)
    && !/^Nmap done:/iu.test(normalized);
}
