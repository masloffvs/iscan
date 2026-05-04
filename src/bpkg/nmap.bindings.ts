import { parseNmapXmlReport, type NmapReport } from "../nmap/report";

import { defineBindings, type BpkgBindingResponseParser, type BpkgTranspiledCommand } from "./define-bindings";

const SUPPORTED_OUTPUT_FORMATS = new Set(["normal", "xml", "grepable"]);
const SUPPORTED_TIMING_TEMPLATES = new Set([0, 1, 2, 3, 4, 5]);

function normalizeRequiredString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} must be a string.`);
	}

	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new Error(`${label} must be a non-empty string.`);
	}

	return normalized;
}

function normalizeOptionalString(value: unknown, label: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	return normalizeRequiredString(value, label);
}

function normalizeBoolean(value: unknown, label: string): boolean | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value !== "boolean") {
		throw new Error(`${label} must be a boolean.`);
	}

	return value;
}

function normalizePositiveInteger(value: unknown, label: string): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(numericValue) || numericValue <= 0) {
		throw new Error(`${label} must be a positive integer.`);
	}

	return numericValue;
}

function normalizeTarget(value: unknown): string {
	return normalizeRequiredString(value, "Nmap target");
}

function normalizePorts(value: unknown): string | undefined {
	const normalized = normalizeOptionalString(value, "Nmap ports");
	return normalized?.replace(/\s+/gu, "");
}

function normalizeTimingTemplate(value: unknown): number {
	if (value === undefined || value === null || value === "") {
		return 3;
	}

	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(numericValue) || !SUPPORTED_TIMING_TEMPLATES.has(numericValue)) {
		throw new Error("Nmap timingTemplate must be an integer between 0 and 5.");
	}

	return numericValue;
}

function normalizeMaxRetries(value: unknown): number {
	return normalizePositiveInteger(value, "Nmap maxRetries") ?? 1;
}

function normalizeTopPorts(value: unknown): number | undefined {
	return normalizePositiveInteger(value, "Nmap topPorts");
}

function normalizeOutputFormat(value: unknown): "normal" | "xml" | "grepable" {
	const normalized = normalizeOptionalString(value, "Nmap outputFormat") ?? "normal";
	if (!SUPPORTED_OUTPUT_FORMATS.has(normalized)) {
		throw new Error("Nmap outputFormat must be one of: normal, xml, grepable.");
	}

	return normalized as "normal" | "xml" | "grepable";
}

function normalizePortSelection(params: { ports?: unknown; topPorts?: unknown }): { ports?: string; topPorts?: number } {
	const ports = normalizePorts(params.ports);
	const topPorts = normalizeTopPorts(params.topPorts);
	if (ports && topPorts !== undefined) {
		throw new Error("Nmap bindings accept either ports or topPorts, not both.");
	}

	return {
		...(ports ? { ports } : {}),
		...(topPorts !== undefined ? { topPorts } : {}),
	};
}

function createRootCommand(argv: readonly string[]): BpkgTranspiledCommand {
	return {
		argv: [...argv],
		createdAt: Date.now(),
		cwd: "/root",
	};
}

function pushOutputArgs(argv: string[], outputFormat: "normal" | "xml" | "grepable", outputPath?: string): void {
	if (!outputPath) {
		if (outputFormat !== "normal") {
			throw new Error("Nmap outputPath is required when outputFormat is xml or grepable.");
		}
		return;
	}

	switch (outputFormat) {
		case "normal":
			argv.push("-oN", outputPath);
			return;
		case "xml":
			argv.push("-oX", outputPath);
			return;
		case "grepable":
			argv.push("-oG", outputPath);
			return;
	}
}

type NmapBaseParams = {
	maxRetries?: unknown;
	outputFormat?: unknown;
	outputPath?: unknown;
	ports?: unknown;
	resolveDns?: unknown;
	skipHostDiscovery?: unknown;
	target?: unknown;
	timingTemplate?: unknown;
	topPorts?: unknown;
};

type NmapStructuredPort = {
	port: number;
	protocol: string;
	raw: string;
	scripts: string[];
	service?: string;
	state: string;
	version?: string;
};

type NmapStructuredHost = {
	address?: string;
	hostname?: string;
	latency?: string;
	macAddress?: string;
	notes: string[];
	ports: NmapStructuredPort[];
	serviceInfo?: string;
	status: string;
	target: string;
	vendor?: string;
};

type NmapStructuredTextReport = {
	hosts: NmapStructuredHost[];
	notes: string[];
	rawLineCount: number;
	summary?: {
		elapsedSeconds?: number;
		raw: string;
		scannedTargets?: number;
		upHosts?: number;
	};
};

export type NmapStructuredResponse = {
	bindingId: string;
	format: "normal" | "xml" | "grepable";
	kind: "nmap-report";
	outputPath?: string;
	report: NmapReport | NmapStructuredTextReport;
	target: string;
};

function trimQuotes(value: string): string {
	return value.replace(/^['"]|['"]$/gu, "").trim();
}

function parseNmapTargetLabel(label: string): { address?: string; hostname?: string; target: string } {
	const normalized = normalizeRequiredString(label, "Nmap parsed target");
	const hostnameMatch = normalized.match(/^(.*)\s+\(([^()]+)\)$/u);
	if (hostnameMatch?.[1] && hostnameMatch[2]) {
		return {
			address: hostnameMatch[2].trim(),
			hostname: hostnameMatch[1].trim(),
			target: normalized,
		};
	}

	const looksLikeAddress = /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalized) || normalized.includes(":");
	return looksLikeAddress
		? { address: normalized, target: normalized }
		: { hostname: normalized, target: normalized };
}

function parseNmapDoneSummary(line: string): NmapStructuredTextReport["summary"] | undefined {
	const match = line.match(/^Nmap done:\s+(\d+) IP addresses? \((\d+) hosts? up\) scanned in ([\d.]+) seconds$/u);
	if (!match) {
		return undefined;
	}

	return {
		elapsedSeconds: Number.parseFloat(match[3]),
		raw: line,
		scannedTargets: Number.parseInt(match[1], 10),
		upHosts: Number.parseInt(match[2], 10),
	};
}

function parseNmapTextReport(text: string): NmapStructuredTextReport {
	const lines = text.split(/\r?\n/u);
	const hosts: NmapStructuredHost[] = [];
	const notes: string[] = [];
	let currentHost: NmapStructuredHost | null = null;
	let parsingPorts = false;
	let summary: NmapStructuredTextReport["summary"] | undefined;

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			parsingPorts = false;
			continue;
		}

		if (trimmed.startsWith("Nmap scan report for ")) {
			const parsedTarget = parseNmapTargetLabel(trimmed.slice("Nmap scan report for ".length));
			currentHost = {
				...parsedTarget,
				notes: [],
				ports: [],
				status: "unknown",
			};
			hosts.push(currentHost);
			parsingPorts = false;
			continue;
		}

		if (trimmed.startsWith("Host is up")) {
			if (currentHost) {
				currentHost.status = "up";
				const latencyMatch = trimmed.match(/\(([^)]+)\)/u);
				if (latencyMatch?.[1]) {
					currentHost.latency = latencyMatch[1].trim();
				}
			}
			continue;
		}

		if (trimmed.startsWith("Host is down")) {
			if (currentHost) {
				currentHost.status = "down";
				currentHost.notes.push(trimmed);
			}
			continue;
		}

		if (/^PORT\s+STATE\s+SERVICE/iu.test(trimmed)) {
			parsingPorts = true;
			continue;
		}

		if (parsingPorts && currentHost) {
			if (/^[|]/u.test(trimmed)) {
				const lastPort = currentHost.ports.at(-1);
				if (lastPort) {
					lastPort.scripts.push(trimmed.replace(/^[|_ ]+/u, "").trim());
				} else {
					currentHost.notes.push(trimmed);
				}
				continue;
			}

			const portMatch = trimmed.match(/^(\d+)\/([a-z0-9]+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/iu);
			if (portMatch) {
				currentHost.ports.push({
					port: Number.parseInt(portMatch[1], 10),
					protocol: portMatch[2],
					raw: trimmed,
					scripts: [],
					service: portMatch[4],
					state: portMatch[3],
					...(portMatch[5] ? { version: portMatch[5].trim() } : {}),
				});
				continue;
			}

			parsingPorts = false;
		}

		if (trimmed.startsWith("MAC Address:")) {
			const macMatch = trimmed.match(/^MAC Address:\s+(\S+)(?:\s+\((.+)\))?$/u);
			if (currentHost && macMatch?.[1]) {
				currentHost.macAddress = macMatch[1];
				if (macMatch[2]) {
					currentHost.vendor = macMatch[2].trim();
				}
			}
			continue;
		}

		if (trimmed.startsWith("Service Info:")) {
			if (currentHost) {
				currentHost.serviceInfo = trimmed.slice("Service Info:".length).trim();
			}
			continue;
		}

		if (trimmed.startsWith("Nmap done:")) {
			summary = parseNmapDoneSummary(trimmed) ?? { raw: trimmed };
			continue;
		}

		if (currentHost) {
			currentHost.notes.push(trimmed);
		} else {
			notes.push(trimmed);
		}
	}

	return {
		hosts,
		notes,
		rawLineCount: lines.filter((line) => line.trim().length > 0).length,
		...(summary ? { summary } : {}),
	};
}

function parseNmapGrepableReport(text: string): NmapStructuredTextReport {
	const lines = text.split(/\r?\n/u);
	const hosts: NmapStructuredHost[] = [];
	const notes: string[] = [];
	let summary: NmapStructuredTextReport["summary"] | undefined;

	for (const rawLine of lines) {
		const trimmed = rawLine.trim();
		if (trimmed.length === 0) {
			continue;
		}

		if (trimmed.startsWith("#")) {
			const payload = trimmed.replace(/^#\s*/u, "");
			if (payload.startsWith("Nmap done:")) {
				summary = parseNmapDoneSummary(payload) ?? { raw: payload };
			} else {
				notes.push(payload);
			}
			continue;
		}

		if (!trimmed.startsWith("Host:")) {
			notes.push(trimmed);
			continue;
		}

		const sections = trimmed.split(/\t+/u).map((entry) => entry.trim()).filter(Boolean);
		const hostSection = sections[0]?.replace(/^Host:\s*/u, "") ?? "";
		const hostMatch = hostSection.match(/^(\S+)(?:\s+\((.*)\))?$/u);
		const address = hostMatch?.[1]?.trim();
		const hostname = hostMatch?.[2] ? trimQuotes(hostMatch[2]) : undefined;
		const statusSection = sections.find((entry) => entry.startsWith("Status:"));
		const portsSection = sections.find((entry) => entry.startsWith("Ports:"));
		const host: NmapStructuredHost = {
			...(address ? { address } : {}),
			...(hostname ? { hostname } : {}),
			notes: sections.filter((entry) => entry !== statusSection && entry !== portsSection && entry !== sections[0]),
			ports: [],
			status: statusSection ? statusSection.slice("Status:".length).trim().toLowerCase() : "unknown",
			target: hostname ? `${hostname} (${address ?? ""})`.trim() : (address ?? hostSection),
		};

		const serializedPorts = portsSection?.slice("Ports:".length).trim();
		if (serializedPorts) {
			for (const rawPortEntry of serializedPorts.split(/,\s*/u)) {
				const fields = rawPortEntry.split("/");
				const port = Number.parseInt(fields[0] ?? "", 10);
				if (!Number.isFinite(port)) {
					continue;
				}

				const version = fields.slice(6).join("/").replace(/\/+$/u, "").trim();
				host.ports.push({
					port,
					protocol: (fields[2] ?? "unknown").trim() || "unknown",
					raw: rawPortEntry,
					scripts: [],
					service: (fields[4] ?? "").trim() || undefined,
					state: (fields[1] ?? "unknown").trim() || "unknown",
					...(version ? { version } : {}),
				});
			}
		}

		hosts.push(host);
	}

	return {
		hosts,
		notes,
		rawLineCount: lines.filter((line) => line.trim().length > 0).length,
		...(summary ? { summary } : {}),
	};
}

const nmapResponseParser: BpkgBindingResponseParser = async (_result, context) => {
	const outputFormat = normalizeOutputFormat(context.params.outputFormat);
	const target = normalizeTarget(context.params.target);
	const outputPath = normalizeOptionalString(context.params.outputPath, "Nmap outputPath");
	const reportText = outputPath ? await context.readFile(outputPath) : _result.stdout;
	const report = outputFormat === "xml"
		? parseNmapXmlReport(reportText)
		: outputFormat === "grepable"
			? parseNmapGrepableReport(reportText)
			: parseNmapTextReport(reportText);

	return {
		bindingId: context.bindingId,
		format: outputFormat,
		kind: "nmap-report",
		...(outputPath ? { outputPath } : {}),
		report,
		target,
	} satisfies NmapStructuredResponse;
};

function createBaseNmapArgv(params: NmapBaseParams): string[] {
	const target = normalizeTarget(params.target);
	const outputPath = normalizeOptionalString(params.outputPath, "Nmap outputPath");
	const outputFormat = normalizeOutputFormat(params.outputFormat);
	const timingTemplate = normalizeTimingTemplate(params.timingTemplate);
	const maxRetries = normalizeMaxRetries(params.maxRetries);
	const resolveDns = normalizeBoolean(params.resolveDns, "Nmap resolveDns") ?? false;
	const skipHostDiscovery = normalizeBoolean(params.skipHostDiscovery, "Nmap skipHostDiscovery") ?? false;
	const portSelection = normalizePortSelection(params);

	const argv = ["nmap", "--unprivileged", "-sT", `-T${timingTemplate}`, "--max-retries", String(maxRetries)];
	if (!resolveDns) {
		argv.push("-n");
	}
	if (skipHostDiscovery) {
		argv.push("-Pn");
	}
	if (portSelection.ports) {
		argv.push("-p", portSelection.ports);
	}
	if (portSelection.topPorts !== undefined) {
		argv.push("--top-ports", String(portSelection.topPorts));
	}

	pushOutputArgs(argv, outputFormat, outputPath);
	argv.push(target);
	return argv;
}

const targetParameter = {
	type: "string",
	description: "Target host, domain, or CIDR expression accepted by nmap.",
	example: "127.0.0.1",
	required: true,
} as const;

const portsParameter = {
	type: "string",
	description: "Optional comma-separated or ranged port selection.",
	example: "22,80,443",
} as const;

const topPortsParameter = {
	type: "number",
	description: "Optional top-ports count instead of an explicit port list.",
	example: "100",
} as const;

const timingTemplateParameter = {
	type: "number",
	description: "Nmap timing template from 0 to 5. Defaults to 3.",
	example: "3",
} as const;

const maxRetriesParameter = {
	type: "number",
	description: "Maximum retry count per probe. Defaults to 1.",
	example: "1",
} as const;

const resolveDnsParameter = {
	type: "boolean",
	description: "Resolve DNS names instead of forcing -n. Defaults to false.",
	example: "true",
} as const;

const skipHostDiscoveryParameter = {
	type: "boolean",
	description: "Skip host discovery with -Pn.",
	example: "true",
} as const;

const outputPathParameter = {
	type: "string",
	description: "Optional output path inside the selected box.",
	example: "/root/nmap-scan.xml",
} as const;

const outputFormatParameter = {
	type: "string",
	description: "Output format: normal, xml, or grepable. xml/grepable require outputPath.",
	example: "xml",
} as const;

const commonScanParameters = {
	target: targetParameter,
	ports: portsParameter,
	topPorts: topPortsParameter,
	timingTemplate: timingTemplateParameter,
	maxRetries: maxRetriesParameter,
	resolveDns: resolveDnsParameter,
	skipHostDiscovery: skipHostDiscoveryParameter,
	outputPath: outputPathParameter,
	outputFormat: outputFormatParameter,
} as const;

export const nmapBindings = defineBindings({
	package: "@bpkg/nmap",
	description: "Nmap - canonical non-interactive TCP connect scans for service discovery and safe script enumeration.",
	dependency: {
		pacman: ["nmap"],
	},
	id: "nmap",
	bindings: {
		connectScan: {
			description: "Run a non-privileged TCP connect scan.",
			defaultParameterName: "target",
			parameters: commonScanParameters,
			responseParser: nmapResponseParser,
		},
		serviceScan: {
			description: "Run a TCP connect scan with version detection.",
			defaultParameterName: "target",
			parameters: commonScanParameters,
			responseParser: nmapResponseParser,
		},
		defaultScriptScan: {
			description: "Run a TCP connect scan with version detection and default NSE scripts.",
			defaultParameterName: "target",
			parameters: commonScanParameters,
			responseParser: nmapResponseParser,
		},
	},
	transformers: {
		async connectScan(params) {
			return createRootCommand(createBaseNmapArgv(params));
		},
		async serviceScan(params) {
			const argv = createBaseNmapArgv(params);
			argv.splice(3, 0, "-sV");
			return createRootCommand(argv);
		},
		async defaultScriptScan(params) {
			const argv = createBaseNmapArgv(params);
			argv.splice(3, 0, "-sV", "-sC");
			return createRootCommand(argv);
		},
	},
});

export default nmapBindings;