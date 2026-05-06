import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { $manifest } from "../manifest";
import { resolveWritableRuntimePath } from "../runtime-paths";
import { readLinuxDistroInfo, type LinuxDistroInfo } from "../utils/distro-detection";
import { parseAirodumpCsvFile, type AirodumpCsvSnapshot } from "../utils/aircrack/airodump-csv";
import { Kit, type KitLifecycleContext } from "./kit";

export const AIRCRACK_KIT_ID = "aircrack";

const AIRCRACK_DEPENDENCY_IDS = ["airmon-ng", "airodump-ng", "iw", "ip", "rfkill", "sudo"] as const;
const DEFAULT_CAPTURE_ROOT = resolveWritableRuntimePath("data", "aircrack", "captures");
const DUMP_STDERR_LIMIT = 32_768;

type AircrackDependencyId = (typeof AIRCRACK_DEPENDENCY_IDS)[number];
type AircrackMonitorSequenceStep = "checkKill" | "start" | "stop" | "setRegion";

type ActiveDumpSessionState = {
	id: string;
	interface: string;
	channel: string[];
	writePrefix: string;
	captureFile: string;
	startedAt: number;
	stoppedAt: number | null;
	exitCode: number | null;
	stderr: string;
	command: string[];
	commandString: string;
	child: ReturnType<typeof Bun.spawn> | null;
	finalizationPromise: Promise<void> | null;
	writeIntervalSeconds: number;
	bssid: string | null;
	essid: string | null;
};

export type AircrackResolvedExecutables = Record<AircrackDependencyId, string | null>;

export type AircrackHostInfo = {
	platform: NodeJS.Platform;
	distro: LinuxDistroInfo;
	isRoot: boolean;
	originalUser: string | null;
	kernelRelease: string;
	dataRoot: string;
	executables: AircrackResolvedExecutables;
};

export type AircrackCommandResult = {
	dependencyId: Exclude<AircrackDependencyId, "sudo">;
	command: string[];
	commandString: string;
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type AircrackWirelessInterface = {
	phy: string | null;
	name: string;
	type: string | null;
	macAddress: string | null;
	ssid: string | null;
	channel: number | null;
	frequencyMHz: number | null;
	channelWidth: string | null;
	state: string | null;
	txPowerDbm: number | null;
	rawBlock: string;
	rawLines: string[];
};

export type AircrackRfkillEntry = {
	id: string;
	name: string;
	type: string | null;
	softBlocked: boolean | null;
	hardBlocked: boolean | null;
	rawBlock: string;
	rawLines: string[];
};

export type AircrackInterferingProcess = {
	pid: number;
	name: string;
	rawLine: string;
};

export type AircrackRegulatorySection = {
	header: string;
	scope: string;
	countryCode: string | null;
	domain: string | null;
	rules: string[];
	rawBlock: string;
};

export type AircrackInterfaceListResult = {
	host: AircrackHostInfo;
	commandResults: AircrackCommandResult[];
	interfaces: AircrackWirelessInterface[];
};

export type AircrackInterfaceStatusResult = {
	host: AircrackHostInfo;
	commandResults: AircrackCommandResult[];
	interface: string;
	found: boolean;
	status: AircrackWirelessInterface | null;
};

export type AircrackRfkillResult = AircrackCommandResult & {
	host: AircrackHostInfo;
	devices: AircrackRfkillEntry[];
};

export type AircrackRegulatoryResult = AircrackCommandResult & {
	host: AircrackHostInfo;
	countryCode: string | null;
	sections: AircrackRegulatorySection[];
};

export type AircrackRegulatoryMutationResult = {
	host: AircrackHostInfo;
	commandResults: AircrackCommandResult[];
	countryCode: string;
	applied: boolean;
	regulatory: AircrackRegulatoryResult;
};

export type AircrackCheckResult = AircrackCommandResult & {
	host: AircrackHostInfo;
	killed: boolean;
	processes: AircrackInterferingProcess[];
};

export type AircrackMonitorStartOptions = {
	channel?: string | number | readonly string[] | readonly number[];
};

export type AircrackMonitorStartResult = {
	host: AircrackHostInfo;
	commandResults: AircrackCommandResult[];
	interface: string;
	channel: string | null;
	monitorInterface: string | null;
	status: AircrackWirelessInterface | null;
};

export type AircrackMonitorStopResult = {
	host: AircrackHostInfo;
	commandResults: AircrackCommandResult[];
	interface: string;
	status: AircrackWirelessInterface | null;
};

export type AircrackMonitorSequencePlan = {
	interface: string;
	channel?: string | number | readonly string[] | readonly number[];
	region?: string;
	steps: readonly AircrackMonitorSequenceStep[];
};

export type AircrackMonitorSequenceResult = {
	host: AircrackHostInfo;
	commandResults: AircrackCommandResult[];
	interface: string;
	channel: string | null;
	region: string | null;
	steps: Array<{
		action: AircrackMonitorSequenceStep;
		result: unknown;
	}>;
	status: AircrackWirelessInterface | null;
	regulatory: AircrackRegulatoryResult | null;
};

export type AircrackDumpStartOptions = {
	interface: string;
	channel?: string | number | readonly string[] | readonly number[];
	write?: string;
	sessionId?: string;
	writeIntervalSeconds?: number;
	bssid?: string;
	essid?: string;
};

export type AircrackDumpSessionSummary = {
	id: string;
	interface: string;
	channel: string[];
	writePrefix: string;
	captureFile: string;
	startedAt: number;
	stoppedAt: number | null;
	active: boolean;
	exitCode: number | null;
	stderr: string;
	command: string[];
	commandString: string;
	writeIntervalSeconds: number;
	bssid: string | null;
	essid: string | null;
};

export type AircrackDumpSessionListResult = {
	host: AircrackHostInfo;
	sessions: AircrackDumpSessionSummary[];
};

export type AircrackDumpSessionStartResult = {
	host: AircrackHostInfo;
	session: AircrackDumpSessionSummary;
};

export type AircrackDumpSnapshotResult = {
	host: AircrackHostInfo;
	target: string;
	resolvedCaptureFile: string;
	exists: boolean;
	session: AircrackDumpSessionSummary | null;
	snapshot: AirodumpCsvSnapshot | null;
};

export type AircrackDumpSessionStopResult = {
	host: AircrackHostInfo;
	alreadyStopped: boolean;
	session: AircrackDumpSessionSummary;
	snapshot: AirodumpCsvSnapshot | null;
};

function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalizedValue = value.trim();
	return normalizedValue.length > 0 ? normalizedValue : null;
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
	const normalizedValue = normalizeOptionalString(value);
	if (!normalizedValue) {
		throw new Error(`${fieldName} must be a non-empty string.`);
	}

	return normalizedValue;
}

function normalizeCountryCode(value: unknown, fieldName = "countryCode"): string {
	const normalizedValue = normalizeRequiredString(value, fieldName).toUpperCase();
	if (!/^[A-Z0-9]{2}$/u.test(normalizedValue)) {
		throw new Error(`${fieldName} must be a 2-character regulatory code.`);
	}

	return normalizedValue;
}

function splitNonEmptyLines(value: string): string[] {
	return value
		.split(/\r?\n/gu)
		.map((line) => line.trimEnd())
		.filter((line) => line.trim().length > 0);
}

function formatCommand(command: readonly string[]): string {
	return command
		.map((argument) => (/^[A-Za-z0-9_./:=,+-]+$/u.test(argument) ? argument : JSON.stringify(argument)))
		.join(" ");
}

async function readOutput(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
	if (!stream) {
		return "";
	}

	const output = await new Response(stream).arrayBuffer();
	return Buffer.from(output).toString("utf8").trim();
}

async function readOutputWithHandler(
	stream: ReadableStream<Uint8Array> | null | undefined,
	handler?: (chunk: string) => void | Promise<void>,
): Promise<string> {
	if (!stream) {
		return "";
	}

	if (!handler) {
		return await readOutput(stream);
	}

	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let output = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			const chunk = decoder.decode(value, { stream: true });
			output += chunk;
			if (chunk.length > 0) {
				await handler(chunk);
			}
		}

		const tail = decoder.decode();
		output += tail;
		if (tail.length > 0) {
			await handler(tail);
		}
	} finally {
		reader.releaseLock();
	}

	return output.trim();
}

function appendTail(value: string, chunk: string, limit: number): string {
	const nextValue = `${value}${chunk}`;
	return nextValue.length <= limit ? nextValue : nextValue.slice(nextValue.length - limit);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeChannelList(value: unknown): string[] {
	if (value === undefined || value === null || value === "") {
		return [];
	}

	if (typeof value === "number") {
		return [String(Math.trunc(value))];
	}

	if (typeof value === "string") {
		return value
			.split(/[\s,]+/u)
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	if (Array.isArray(value)) {
		return value
			.map((entry, index) => {
				if (typeof entry === "number") {
					return String(Math.trunc(entry));
				}

				return normalizeRequiredString(entry, `channel[${index}]`);
			})
			.filter(Boolean);
	}

	throw new Error("channel must be a string, number, or array.");
}

function normalizeSingleChannel(value: unknown): string | null {
	const channels = normalizeChannelList(value);
	if (channels.length === 0) {
		return null;
	}

	if (channels.length > 1) {
		throw new Error("monitor.start supports at most one channel value.");
	}

	return channels[0] ?? null;
}

function normalizeWriteIntervalSeconds(value: unknown): number {
	if (value === undefined || value === null || value === "") {
		return 1;
	}

	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error("writeIntervalSeconds must be a finite number.");
	}

	const roundedValue = Math.round(value);
	if (roundedValue < 1 || roundedValue > 60) {
		throw new Error("writeIntervalSeconds must be between 1 and 60 seconds.");
	}

	return roundedValue;
}

function normalizeOptionalMac(value: unknown, fieldName: string): string | null {
	if (value === undefined || value === null || value === "") {
		return null;
	}

	const normalizedValue = normalizeRequiredString(value, fieldName).toUpperCase();
	if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/u.test(normalizedValue)) {
		throw new Error(`${fieldName} must be a MAC address like 00:11:22:33:44:55.`);
	}

	return normalizedValue;
}

function parseIpLinkStates(value: string): Map<string, string> {
	const states = new Map<string, string>();
	for (const line of splitNonEmptyLines(value)) {
		const parts = line.trim().split(/\s+/u);
		const name = parts[0]?.replace(/:$/u, "") ?? "";
		const state = parts[1] ?? "";
		if (name.length > 0 && state.length > 0) {
			states.set(name, state);
		}
	}

	return states;
}

function parseWirelessInterfaces(iwOutput: string, ipOutput: string): AircrackWirelessInterface[] {
	const linkStates = parseIpLinkStates(ipOutput);
	const interfaces: AircrackWirelessInterface[] = [];
	let currentPhy: string | null = null;
	let currentName: string | null = null;
	let currentLines: string[] = [];
	let currentType: string | null = null;
	let currentMacAddress: string | null = null;
	let currentSsid: string | null = null;
	let currentChannel: number | null = null;
	let currentFrequencyMHz: number | null = null;
	let currentChannelWidth: string | null = null;
	let currentTxPowerDbm: number | null = null;

	const flushCurrentInterface = () => {
		if (!currentName) {
			return;
		}

		interfaces.push({
			phy: currentPhy,
			name: currentName,
			type: currentType,
			macAddress: currentMacAddress,
			ssid: currentSsid,
			channel: currentChannel,
			frequencyMHz: currentFrequencyMHz,
			channelWidth: currentChannelWidth,
			state: linkStates.get(currentName) ?? null,
			txPowerDbm: currentTxPowerDbm,
			rawBlock: currentLines.join("\n"),
			rawLines: [...currentLines],
		});
	};

	for (const rawLine of iwOutput.split(/\r?\n/gu)) {
		const trimmedLine = rawLine.trim();
		if (trimmedLine.length === 0) {
			continue;
		}

		const phyMatch = trimmedLine.match(/^phy#(?<index>\d+)$/u);
		if (phyMatch?.groups?.index) {
			flushCurrentInterface();
			currentPhy = `phy#${phyMatch.groups.index}`;
			currentName = null;
			currentLines = [];
			currentType = null;
			currentMacAddress = null;
			currentSsid = null;
			currentChannel = null;
			currentFrequencyMHz = null;
			currentChannelWidth = null;
			currentTxPowerDbm = null;
			continue;
		}

		if (trimmedLine.startsWith("Interface ")) {
			flushCurrentInterface();
			currentName = trimmedLine.slice("Interface ".length).trim();
			currentLines = [rawLine.trimEnd()];
			currentType = null;
			currentMacAddress = null;
			currentSsid = null;
			currentChannel = null;
			currentFrequencyMHz = null;
			currentChannelWidth = null;
			currentTxPowerDbm = null;
			continue;
		}

		if (!currentName) {
			continue;
		}

		currentLines.push(rawLine.trimEnd());
		if (trimmedLine.startsWith("type ")) {
			currentType = normalizeOptionalString(trimmedLine.slice("type ".length));
			continue;
		}

		if (trimmedLine.startsWith("addr ")) {
			currentMacAddress = normalizeOptionalString(trimmedLine.slice("addr ".length));
			continue;
		}

		if (trimmedLine.startsWith("ssid ")) {
			currentSsid = normalizeOptionalString(trimmedLine.slice("ssid ".length));
			continue;
		}

		const channelMatch = trimmedLine.match(/^channel\s+(?<channel>\d+)\s+\((?<frequency>\d+)\s+MHz\)(?:,\s+width:\s*(?<width>[^,]+))?/u);
		if (channelMatch?.groups) {
			currentChannel = Number.parseInt(channelMatch.groups.channel, 10) || null;
			currentFrequencyMHz = Number.parseInt(channelMatch.groups.frequency, 10) || null;
			currentChannelWidth = normalizeOptionalString(channelMatch.groups.width);
			continue;
		}

		const txPowerMatch = trimmedLine.match(/^txpower\s+(?<value>-?\d+(?:\.\d+)?)\s+dBm$/u);
		if (txPowerMatch?.groups?.value) {
			const parsedValue = Number.parseFloat(txPowerMatch.groups.value);
			currentTxPowerDbm = Number.isFinite(parsedValue) ? parsedValue : null;
		}
	}

	flushCurrentInterface();
	return interfaces;
}

function parseBooleanToggle(value: string): boolean | null {
	const normalizedValue = value.trim().toLowerCase();
	if (normalizedValue === "yes") {
		return true;
	}

	if (normalizedValue === "no") {
		return false;
	}

	return null;
}

function parseRfkillEntries(value: string): AircrackRfkillEntry[] {
	const blocks: string[][] = [];
	let currentBlock: string[] = [];

	for (const rawLine of value.split(/\r?\n/gu)) {
		if (rawLine.trim().length === 0) {
			continue;
		}

		if (/^\d+:\s/u.test(rawLine) && currentBlock.length > 0) {
			blocks.push(currentBlock);
			currentBlock = [];
		}

		currentBlock.push(rawLine.trimEnd());
	}

	if (currentBlock.length > 0) {
		blocks.push(currentBlock);
	}

	return blocks.map((block) => {
		const header = block[0] ?? "";
		const headerMatch = header.match(/^(?<id>\d+):\s+(?<name>.+?):\s+(?<type>.+)$/u);
		let softBlocked: boolean | null = null;
		let hardBlocked: boolean | null = null;

		for (const line of block.slice(1)) {
			const trimmedLine = line.trim();
			const separatorIndex = trimmedLine.indexOf(":");
			if (separatorIndex < 0) {
				continue;
			}

			const key = trimmedLine.slice(0, separatorIndex).trim();
			const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
			if (key === "Soft blocked") {
				softBlocked = parseBooleanToggle(rawValue);
				continue;
			}

			if (key === "Hard blocked") {
				hardBlocked = parseBooleanToggle(rawValue);
			}
		}

		return {
			id: headerMatch?.groups?.id ?? "",
			name: normalizeOptionalString(headerMatch?.groups?.name) ?? header,
			type: normalizeOptionalString(headerMatch?.groups?.type),
			softBlocked,
			hardBlocked,
			rawBlock: block.join("\n"),
			rawLines: [...block],
		};
	});
}

function parseRegulatorySections(value: string): AircrackRegulatorySection[] {
	const blocks: string[][] = [];
	let currentBlock: string[] = [];

	for (const rawLine of value.split(/\r?\n/gu)) {
		if (rawLine.trim().length === 0) {
			continue;
		}

		if (!/^\s/iu.test(rawLine) && currentBlock.length > 0) {
			blocks.push(currentBlock);
			currentBlock = [];
		}

		currentBlock.push(rawLine.trimEnd());
	}

	if (currentBlock.length > 0) {
		blocks.push(currentBlock);
	}

	return blocks.map((block) => {
		const header = block[0]?.trim() ?? "";
		const countryMatch = header.match(/country\s+(?<country>[A-Z0-9]{2})(?::\s*(?<domain>[A-Z0-9-]+))?/iu);
		return {
			header,
			scope: header === "global" ? "global" : header.split(/\s+/u)[0] ?? header,
			countryCode: countryMatch?.groups?.country?.toUpperCase() ?? null,
			domain: normalizeOptionalString(countryMatch?.groups?.domain),
			rules: block.slice(1).map((line) => line.trim()),
			rawBlock: block.join("\n"),
		};
	});
}

function parseAirmonCheckProcesses(value: string): AircrackInterferingProcess[] {
	return splitNonEmptyLines(value)
		.map((line) => {
			const match = line.match(/^\s*(?<pid>\d+)\s+(?<name>.+)$/u);
			if (!match?.groups) {
				return null;
			}

			const pid = Number.parseInt(match.groups.pid, 10);
			if (!Number.isFinite(pid)) {
				return null;
			}

			return {
				pid,
				name: match.groups.name.trim(),
				rawLine: line,
			};
		})
		.filter((entry): entry is AircrackInterferingProcess => Boolean(entry));
}

function extractMonitorInterfaceName(value: string): string | null {
	const patterns = [
		/ on \[[^\]]+\](?<name>[^\s)]+)\)?/u,
		/monitor mode enabled on (?<name>\S+)/u,
		/monitor mode vif enabled.* on (?<name>\S+)/u,
	];

	for (const pattern of patterns) {
		const match = value.match(pattern);
		const candidate = normalizeOptionalString(match?.groups?.name);
		if (candidate) {
			return candidate;
		}
	}

	return null;
}

function buildCommandErrorMessage(result: AircrackCommandResult): string {
	const output = result.stderr || result.stdout || "Command failed without output.";
	return [
		`Aircrack command failed with exit code ${result.exitCode}.`,
		`Command: ${result.commandString}`,
		output,
	].join("\n");
}

function resolveAvailableManifestDependencyCommand(dependencyId: AircrackDependencyId): string | null {
	const dependency = $manifest.refreshDependency(dependencyId);
	if (!dependency.available) {
		return null;
	}

	return dependency.resolvedPath ?? dependency.resolvedBinary ?? dependency.binary;
}

function createExecutableSnapshot(): AircrackResolvedExecutables {
	return {
		"airmon-ng": resolveAvailableManifestDependencyCommand("airmon-ng"),
		"airodump-ng": resolveAvailableManifestDependencyCommand("airodump-ng"),
		iw: resolveAvailableManifestDependencyCommand("iw"),
		ip: resolveAvailableManifestDependencyCommand("ip"),
		rfkill: resolveAvailableManifestDependencyCommand("rfkill"),
		sudo: resolveAvailableManifestDependencyCommand("sudo"),
	};
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function readOptionalFileText(filePath: string): Promise<string | null> {
	try {
		const content = await fs.readFile(filePath, "utf8");
		const normalizedValue = content.trim();
		return normalizedValue.length > 0 ? normalizedValue : null;
	} catch {
		return null;
	}
}

async function parseSysfsWirelessInterfaces(ipOutput: string): Promise<AircrackWirelessInterface[]> {
	const linkStates = parseIpLinkStates(ipOutput);
	const interfaces: AircrackWirelessInterface[] = [];

	for (const [name, state] of linkStates.entries()) {
		const wirelessDirectory = path.join("/sys/class/net", name, "wireless");
		if (!(await fileExists(wirelessDirectory))) {
			continue;
		}

		interfaces.push({
			phy: null,
			name,
			type: null,
			macAddress: await readOptionalFileText(path.join("/sys/class/net", name, "address")),
			ssid: null,
			channel: null,
			frequencyMHz: null,
			channelWidth: null,
			state,
			txPowerDbm: null,
			rawBlock: `sysfs:${name}`,
			rawLines: [`sysfs:${name}`],
		});
	}

	return interfaces;
}

async function findCaptureFileForPrefix(prefixPath: string): Promise<string> {
	const defaultCapturePath = `${prefixPath}-01.csv`;
	const directoryPath = path.dirname(prefixPath);
	const prefixName = path.basename(prefixPath);

	try {
		const entries = await fs.readdir(directoryPath, { withFileTypes: true });
		const matches = entries
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name)
			.filter((entry) => new RegExp(`^${escapeRegex(prefixName)}-(\\d+)\\.csv$`, "u").test(entry))
			.sort((left, right) => {
				const leftMatch = left.match(/-(\d+)\.csv$/u);
				const rightMatch = right.match(/-(\d+)\.csv$/u);
				const leftIndex = Number.parseInt(leftMatch?.[1] ?? "0", 10) || 0;
				const rightIndex = Number.parseInt(rightMatch?.[1] ?? "0", 10) || 0;
				return rightIndex - leftIndex;
			});

		if (matches.length > 0) {
			return path.join(directoryPath, matches[0] ?? "");
		}
	} catch {
		return defaultCapturePath;
	}

	return defaultCapturePath;
}

export class AircrackKit extends Kit {
	private readonly dataRoot: string;
	private hostInfo: AircrackHostInfo = {
		platform: process.platform,
		distro: {
			id: null,
			idLike: [],
			name: null,
			prettyName: null,
			versionId: null,
		},
		isRoot: false,
		originalUser: null,
		kernelRelease: os.release(),
		dataRoot: path.resolve(DEFAULT_CAPTURE_ROOT),
		executables: createExecutableSnapshot(),
	};
	private readonly dumpSessions = new Map<string, ActiveDumpSessionState>();

	constructor(options: { dataRoot?: string } = {}) {
		super({
			id: AIRCRACK_KIT_ID,
			name: "Aircrack Kit",
			description: "Manage wireless monitor mode and file-backed airodump-ng capture sessions on the host.",
		});
		this.dataRoot = path.resolve(options.dataRoot ?? DEFAULT_CAPTURE_ROOT);
		this.hostInfo.dataRoot = this.dataRoot;
	}

	protected override async onStart(_context: KitLifecycleContext): Promise<void> {
		await fs.mkdir(this.dataRoot, { recursive: true });
		this.hostInfo = {
			platform: process.platform,
			distro: await readLinuxDistroInfo(),
			isRoot: typeof process.getuid === "function" ? process.getuid() === 0 : false,
			originalUser: normalizeOptionalString(process.env.SUDO_USER) ?? normalizeOptionalString(process.env.USER),
			kernelRelease: os.release(),
			dataRoot: this.dataRoot,
			executables: createExecutableSnapshot(),
		};
	}

	protected override async onStop(_context: KitLifecycleContext): Promise<void> {
		const activeSessions = [...this.dumpSessions.values()].filter((session) => session.child !== null);
		await Promise.allSettled(activeSessions.map(async (session) => {
			await this.stopDumpSession(session.id);
		}));
	}

	getHostInfo(): AircrackHostInfo {
		return structuredClone(this.hostInfo);
	}

	async listWirelessInterfaces(): Promise<AircrackInterfaceListResult> {
		const ipResult = await this.runDependencyCommand("ip", ["-brief", "link"]);
		const iwCommand = this.hostInfo.executables.iw ?? resolveAvailableManifestDependencyCommand("iw");
		if (!iwCommand) {
			return {
				host: this.getHostInfo(),
				commandResults: [ipResult],
				interfaces: await parseSysfsWirelessInterfaces(ipResult.stdout),
			};
		}

		const iwResult = await this.runDependencyCommand("iw", ["dev"]);
		return {
			host: this.getHostInfo(),
			commandResults: [iwResult, ipResult],
			interfaces: parseWirelessInterfaces(iwResult.stdout, ipResult.stdout),
		};
	}

	async getWirelessInterface(name: string): Promise<AircrackInterfaceStatusResult> {
		const normalizedName = normalizeRequiredString(name, "interface");
		const interfacesResult = await this.listWirelessInterfaces();
		const status = interfacesResult.interfaces.find((entry) => entry.name === normalizedName) ?? null;
		return {
			host: interfacesResult.host,
			commandResults: interfacesResult.commandResults,
			interface: normalizedName,
			found: status !== null,
			status,
		};
	}

	async listRfkill(): Promise<AircrackRfkillResult> {
		const result = await this.runDependencyCommand("rfkill", ["list"]);
		return {
			...result,
			host: this.getHostInfo(),
			devices: parseRfkillEntries(result.stdout),
		};
	}

	async getRegulatoryDomain(): Promise<AircrackRegulatoryResult> {
		const result = await this.runDependencyCommand("iw", ["reg", "get"]);
		const sections = parseRegulatorySections(result.stdout);
		const countryCode = sections.find((section) => section.scope === "global")?.countryCode
			?? sections.find((section) => section.countryCode !== null)?.countryCode
			?? null;
		return {
			...result,
			host: this.getHostInfo(),
			countryCode,
			sections,
		};
	}

	async setRegulatoryDomain(countryCode: string): Promise<AircrackRegulatoryMutationResult> {
		const normalizedCountryCode = normalizeCountryCode(countryCode);
		const setResult = await this.runDependencyCommand("iw", ["reg", "set", normalizedCountryCode], { mutating: true });
		const regulatory = await this.getRegulatoryDomain();
		return {
			host: this.getHostInfo(),
			commandResults: [setResult, regulatory],
			countryCode: normalizedCountryCode,
			applied: regulatory.countryCode === normalizedCountryCode,
			regulatory,
		};
	}

	async checkProcesses(options: { kill?: boolean } = {}): Promise<AircrackCheckResult> {
		const killed = options.kill === true;
		const result = await this.runDependencyCommand("airmon-ng", killed ? ["check", "kill"] : ["check"], { mutating: killed });
		return {
			...result,
			host: this.getHostInfo(),
			killed,
			processes: parseAirmonCheckProcesses(result.stdout),
		};
	}

	async startMonitor(interfaceName: string, options: AircrackMonitorStartOptions = {}): Promise<AircrackMonitorStartResult> {
		const normalizedInterface = normalizeRequiredString(interfaceName, "interface");
		const channel = normalizeSingleChannel(options.channel);
		const startResult = await this.runDependencyCommand(
			"airmon-ng",
			["start", normalizedInterface, ...(channel ? [channel] : [])],
			{ mutating: true },
		);
		const statusResult = await this.listWirelessInterfaces();
		const monitorInterface = extractMonitorInterfaceName(`${startResult.stdout}\n${startResult.stderr}`);
		const candidateNames = [monitorInterface, normalizedInterface].filter((value): value is string => Boolean(value));
		const status = statusResult.interfaces.find((entry) => candidateNames.includes(entry.name))
			?? statusResult.interfaces.find((entry) => entry.type === "monitor" && candidateNames.length === 0)
			?? null;
		return {
			host: this.getHostInfo(),
			commandResults: [startResult, ...statusResult.commandResults],
			interface: normalizedInterface,
			channel,
			monitorInterface: status?.name ?? monitorInterface,
			status,
		};
	}

	async stopMonitor(interfaceName: string): Promise<AircrackMonitorStopResult> {
		const normalizedInterface = normalizeRequiredString(interfaceName, "interface");
		const stopResult = await this.runDependencyCommand("airmon-ng", ["stop", normalizedInterface], { mutating: true });
		const statusResult = await this.listWirelessInterfaces();
		const baseName = normalizedInterface.endsWith("mon") ? normalizedInterface.slice(0, -3) : normalizedInterface;
		const status = statusResult.interfaces.find((entry) => entry.name === normalizedInterface || entry.name === baseName) ?? null;
		return {
			host: this.getHostInfo(),
			commandResults: [stopResult, ...statusResult.commandResults],
			interface: normalizedInterface,
			status,
		};
	}

	async runMonitorSequence(plan: AircrackMonitorSequencePlan): Promise<AircrackMonitorSequenceResult> {
		const normalizedInterface = normalizeRequiredString(plan.interface, "interface");
		const orderedSteps = [...plan.steps];
		if (orderedSteps.length === 0) {
			throw new Error("steps must contain at least one monitor action.");
		}

		const channel = normalizeSingleChannel(plan.channel);
		const region = plan.region ? normalizeCountryCode(plan.region, "region") : null;
		const commandResults: AircrackCommandResult[] = [];
		const steps: AircrackMonitorSequenceResult["steps"] = [];
		let currentInterface = normalizedInterface;
		let status: AircrackWirelessInterface | null = null;
		let regulatory: AircrackRegulatoryResult | null = null;

		for (const step of orderedSteps) {
			if (step === "checkKill") {
				const result = await this.checkProcesses({ kill: true });
				commandResults.push(result);
				steps.push({ action: step, result });
				continue;
			}

			if (step === "start") {
				const result = await this.startMonitor(currentInterface, { channel });
				currentInterface = result.monitorInterface ?? currentInterface;
				status = result.status;
				commandResults.push(...result.commandResults);
				steps.push({ action: step, result });
				continue;
			}

			if (step === "stop") {
				const result = await this.stopMonitor(currentInterface);
				status = result.status;
				commandResults.push(...result.commandResults);
				steps.push({ action: step, result });
				continue;
			}

			if (!region) {
				throw new Error("region is required when using setRegion in a monitor sequence.");
			}

			const result = await this.setRegulatoryDomain(region);
			regulatory = result.regulatory;
			commandResults.push(...result.commandResults);
			steps.push({ action: step, result });
		}

		if (!status && orderedSteps.some((step) => step === "start" || step === "stop")) {
			const statusResult = await this.getWirelessInterface(currentInterface);
			status = statusResult.status;
			commandResults.push(...statusResult.commandResults);
		}

		return {
			host: this.getHostInfo(),
			commandResults,
			interface: normalizedInterface,
			channel,
			region,
			steps,
			status,
			regulatory,
		};
	}

	listDumpSessions(): AircrackDumpSessionListResult {
		return {
			host: this.getHostInfo(),
			sessions: [...this.dumpSessions.values()]
				.map((session) => this.summarizeDumpSession(session))
				.sort((left, right) => right.startedAt - left.startedAt),
		};
	}

	async startDumpSession(options: AircrackDumpStartOptions): Promise<AircrackDumpSessionStartResult> {
		const normalizedInterface = normalizeRequiredString(options.interface, "interface");
		const channels = normalizeChannelList(options.channel);
		const sessionId = normalizeOptionalString(options.sessionId) ?? randomUUID();
		if (this.dumpSessions.has(sessionId)) {
			throw new Error(`dump session '${sessionId}' already exists.`);
		}

		const writeIntervalSeconds = normalizeWriteIntervalSeconds(options.writeIntervalSeconds);
		const bssid = normalizeOptionalMac(options.bssid, "bssid");
		const essid = normalizeOptionalString(options.essid);
		const writePrefix = this.resolveWritePrefix(options.write, sessionId);
		await fs.mkdir(path.dirname(writePrefix), { recursive: true });
		const command = this.buildPrivilegedCommand([
			this.resolveDependencyCommand("airodump-ng", "AircrackKit requires 'airodump-ng' to start capture sessions"),
			"--write",
			writePrefix,
			"--output-format",
			"csv",
			"--write-interval",
			String(writeIntervalSeconds),
			...(channels.length > 0 ? ["--channel", channels.join(",")] : []),
			...(bssid ? ["--bssid", bssid] : []),
			...(essid ? ["--essid", essid] : []),
			normalizedInterface,
		]);
		const child = Bun.spawn({
			cmd: [...command],
			stdin: "ignore",
			stdout: "ignore",
			stderr: "pipe",
		});

		const session: ActiveDumpSessionState = {
			id: sessionId,
			interface: normalizedInterface,
			channel: [...channels],
			writePrefix,
			captureFile: `${writePrefix}-01.csv`,
			startedAt: Date.now(),
			stoppedAt: null,
			exitCode: null,
			stderr: "",
			command: [...command],
			commandString: formatCommand(command),
			child,
			finalizationPromise: null,
			writeIntervalSeconds,
			bssid,
			essid,
		};
		this.dumpSessions.set(sessionId, session);

		const stderrDone = readOutputWithHandler(child.stderr, async (chunk) => {
			session.stderr = appendTail(session.stderr, chunk, DUMP_STDERR_LIMIT);
		});
		session.finalizationPromise = this.trackDumpSession(session, stderrDone);

		const startupState = await Promise.race([
			child.exited.then((exitCode) => ({ exited: true as const, exitCode })),
			new Promise<{ exited: false; exitCode: null }>((resolve) => {
				setTimeout(() => resolve({ exited: false, exitCode: null }), 750);
			}),
		]);

		if (startupState.exited) {
			await session.finalizationPromise;
			this.dumpSessions.delete(sessionId);
			throw new Error([
				`airodump-ng exited immediately with code ${startupState.exitCode}.`,
				`Command: ${session.commandString}`,
				session.stderr || "airodump-ng failed without stderr output.",
			].join("\n"));
		}

		return {
			host: this.getHostInfo(),
			session: this.summarizeDumpSession(session),
		};
	}

	async snapshotDumpSession(target: string): Promise<AircrackDumpSnapshotResult> {
		const normalizedTarget = normalizeRequiredString(target, "target");
		const session = this.dumpSessions.get(normalizedTarget) ?? null;
		const resolvedCaptureFile = session
			? await this.refreshCaptureFile(session)
			: await this.resolveSnapshotTargetPath(normalizedTarget);
		const exists = await fileExists(resolvedCaptureFile);
		if (!exists) {
			return {
				host: this.getHostInfo(),
				target: normalizedTarget,
				resolvedCaptureFile,
				exists: false,
				session: session ? this.summarizeDumpSession(session) : null,
				snapshot: null,
			};
		}

		return {
			host: this.getHostInfo(),
			target: normalizedTarget,
			resolvedCaptureFile,
			exists: true,
			session: session ? this.summarizeDumpSession(session) : null,
			snapshot: await parseAirodumpCsvFile(resolvedCaptureFile),
		};
	}

	async stopDumpSession(sessionId: string): Promise<AircrackDumpSessionStopResult> {
		const normalizedSessionId = normalizeRequiredString(sessionId, "sessionId");
		const session = this.dumpSessions.get(normalizedSessionId);
		if (!session) {
			throw new Error(`Unknown dump session: ${normalizedSessionId}`);
		}

		const alreadyStopped = session.child === null;
		if (session.child) {
			session.child.kill();
		}

		if (session.finalizationPromise) {
			await session.finalizationPromise;
		}

		const captureFile = await this.refreshCaptureFile(session);
		const snapshot = await fileExists(captureFile)
			? await parseAirodumpCsvFile(captureFile)
			: null;

		return {
			host: this.getHostInfo(),
			alreadyStopped,
			session: this.summarizeDumpSession(session),
			snapshot,
		};
	}

	private summarizeDumpSession(session: ActiveDumpSessionState): AircrackDumpSessionSummary {
		return {
			id: session.id,
			interface: session.interface,
			channel: [...session.channel],
			writePrefix: session.writePrefix,
			captureFile: session.captureFile,
			startedAt: session.startedAt,
			stoppedAt: session.stoppedAt,
			active: session.child !== null,
			exitCode: session.exitCode,
			stderr: session.stderr,
			command: [...session.command],
			commandString: session.commandString,
			writeIntervalSeconds: session.writeIntervalSeconds,
			bssid: session.bssid,
			essid: session.essid,
		};
	}

	private async trackDumpSession(session: ActiveDumpSessionState, stderrDone: Promise<string>): Promise<void> {
		if (!session.child) {
			return;
		}

		const child = session.child;
		const [exitCode, stderr] = await Promise.all([child.exited, stderrDone]);
		session.exitCode = exitCode;
		if (session.stderr.length === 0 && stderr.length > 0) {
			session.stderr = appendTail("", stderr, DUMP_STDERR_LIMIT);
		}
		session.stoppedAt ??= Date.now();
		session.child = null;
	}

	private resolveWritePrefix(write: string | undefined, sessionId: string): string {
		const normalizedWrite = normalizeOptionalString(write);
		if (!normalizedWrite) {
			return path.join(this.dataRoot, sessionId);
		}

		const withoutCsvSuffix = normalizedWrite.replace(/\.csv$/iu, "");
		return path.isAbsolute(withoutCsvSuffix)
			? path.resolve(withoutCsvSuffix)
			: path.resolve(process.cwd(), withoutCsvSuffix);
	}

	private async refreshCaptureFile(session: ActiveDumpSessionState): Promise<string> {
		session.captureFile = await findCaptureFileForPrefix(session.writePrefix);
		return session.captureFile;
	}

	private async resolveSnapshotTargetPath(target: string): Promise<string> {
		if (target.endsWith(".csv")) {
			return path.isAbsolute(target) ? path.resolve(target) : path.resolve(process.cwd(), target);
		}

		const prefixPath = path.isAbsolute(target) ? path.resolve(target) : path.resolve(process.cwd(), target);
		return await findCaptureFileForPrefix(prefixPath);
	}

	private assertLinux(): void {
		if (this.hostInfo.platform !== "linux") {
			throw new Error(`AircrackKit supports only Linux hosts. Current platform: ${this.hostInfo.platform}.`);
		}
	}

	private resolveDependencyCommand(id: AircrackDependencyId, reason: string): string {
		const command = $manifest.resolveDependencyCommand(id, reason);
		this.hostInfo.executables[id] = command;
		return command;
	}

	private buildPrivilegedCommand(command: readonly string[]): string[] {
		if (this.hostInfo.isRoot) {
			return [...command];
		}

		const sudoCommand = this.resolveDependencyCommand(
			"sudo",
			"AircrackKit mutating operations require sudo when the current process is not running as root",
		);
		return [sudoCommand, "-n", ...command];
	}

	private async runDependencyCommand(
		id: Exclude<AircrackDependencyId, "sudo">,
		args: readonly string[],
		options: { allowFailure?: boolean; mutating?: boolean } = {},
	): Promise<AircrackCommandResult> {
		this.assertLinux();
		const executable = this.resolveDependencyCommand(id, `AircrackKit requires '${id}' to manage host wireless interfaces`);
		const baseCommand = [executable, ...args];
		const command = options.mutating ? this.buildPrivilegedCommand(baseCommand) : baseCommand;
		const child = Bun.spawn({
			cmd: [...command],
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});

		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			readOutput(child.stdout),
			readOutput(child.stderr),
		]);

		const result: AircrackCommandResult = {
			dependencyId: id,
			command: [...command],
			commandString: formatCommand(command),
			exitCode,
			stdout,
			stderr,
		};

		if (exitCode !== 0 && !options.allowFailure) {
			throw new Error(buildCommandErrorMessage(result));
		}

		return result;
	}
}