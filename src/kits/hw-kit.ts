import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { $manifest } from "../manifest";
import {
	isArchCompatibleDistro,
	readLinuxDistroInfo,
	type LinuxDistroInfo,
} from "../utils/distro-detection";
import { Kit, type KitLifecycleContext } from "./kit";

export const HW_KIT_ID = "hw";

const HW_DEPENDENCY_IDS = ["lspci", "lsmod", "lsusb", "modinfo", "modprobe", "rmmod", "sudo"] as const;

type HwDependencyId = (typeof HW_DEPENDENCY_IDS)[number];

export type HwResolvedExecutables = Record<HwDependencyId, string | null>;

export type HwHostInfo = {
	platform: NodeJS.Platform;
	distro: LinuxDistroInfo;
	archCompatible: boolean;
	isRoot: boolean;
	originalUser: string | null;
	kernelRelease: string;
	modulesDirectory: string;
	executables: HwResolvedExecutables;
};

export type HwCommandResult = {
	dependencyId: Exclude<HwDependencyId, "sudo">;
	command: string[];
	commandString: string;
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type HwPciDevice = {
	address: string;
	className: string;
	classCode: string | null;
	description: string;
	revision: string | null;
	vendorDeviceId: string | null;
	subsystem: string | null;
	kernelDriverInUse: string | null;
	kernelModules: string[];
	properties: Record<string, string>;
	rawBlock: string;
	rawLines: string[];
};

export type HwUsbDevice = {
	bus: string;
	device: string;
	vendorId: string;
	productId: string;
	id: string;
	description: string | null;
	rawLine: string;
};

export type HwLoadedModule = {
	name: string;
	size: number;
	usedByCount: number;
	usedBy: string[];
	rawLine: string;
};

export type HwModuleParameter = {
	name: string;
	description: string;
	raw: string;
};

export type HwModuleInfo = {
	name: string;
	filename: string | null;
	description: string | null;
	license: string[];
	aliases: string[];
	depends: string[];
	firmware: string[];
	parameters: HwModuleParameter[];
	fields: Record<string, string | string[]>;
	raw: string;
};

export type HwPciListResult = HwCommandResult & {
	host: HwHostInfo;
	devices: HwPciDevice[];
};

export type HwUsbListResult = HwCommandResult & {
	host: HwHostInfo;
	devices: HwUsbDevice[];
};

export type HwLoadedModulesResult = HwCommandResult & {
	host: HwHostInfo;
	modules: HwLoadedModule[];
};

export type HwDriverLookupResult = HwCommandResult & {
	host: HwHostInfo;
	address: string;
	found: boolean;
	device: HwPciDevice | null;
};

export type HwModuleInfoResult = HwCommandResult & {
	host: HwHostInfo;
	name: string;
	found: boolean;
	info: HwModuleInfo | null;
};

export type HwModuleLoadOptions = {
	params?: string | string[];
};

export type HwModuleUnloadOptions = {
	force?: boolean;
};

export type HwModuleReloadOptions = HwModuleUnloadOptions & HwModuleLoadOptions;

export type HwModuleMutationResult = {
	action: "load" | "reload" | "unload";
	host: HwHostInfo;
	name: string;
	requestedParams: string[];
	force: boolean;
	beforeLoaded: boolean;
	afterLoaded: boolean;
	skipped: boolean;
	commandResults: HwCommandResult[];
	before: HwLoadedModule | null;
	after: HwLoadedModule | null;
};

export type HwDriverSuggestion = {
	address: string;
	className: string;
	description: string;
	currentDriver: string | null;
	candidateModules: string[];
	installedCandidateModules: string[];
	status: "bound" | "candidate-module" | "unknown";
	packageHints: Array<{
		packageName: string;
		reason: string;
		heuristic: true;
	}>;
	rawBlock: string;
};

export type HwSuggestResult = {
	host: HwHostInfo;
	kernelRelease: string;
	modulesDirectory: string;
	availableModuleCount: number;
	suggestions: HwDriverSuggestion[];
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

function normalizeBoolean(value: unknown, fallback = false): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function splitNonEmptyLines(value: string): string[] {
	return value
		.split(/\r?\n/gu)
		.map((line) => line.trimEnd())
		.filter((line) => line.trim().length > 0);
}

function splitCommaSeparated(value: string): string[] {
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

function normalizeModuleToken(value: string): string {
	return value.trim().replace(/-/gu, "_").toLowerCase();
}

function stripModuleFileSuffix(value: string): string {
	return value.replace(/\.ko(?:\.[^./]+)?$/u, "");
}

function parseModuleParams(value: unknown): string[] {
	if (value === undefined || value === null || value === "") {
		return [];
	}

	if (typeof value === "string") {
		return value
			.split(/\s+/u)
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	if (Array.isArray(value)) {
		return value.map((entry, index) => normalizeRequiredString(entry, `params[${index}]`));
	}

	throw new Error("params must be a string or array of strings.");
}

async function readOutput(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
	if (!stream) {
		return "";
	}

	const output = await new Response(stream).arrayBuffer();
	return Buffer.from(output).toString("utf8").trim();
}

function formatCommand(command: readonly string[]): string {
	return command
		.map((argument) => (/^[A-Za-z0-9_./:=,+-]+$/u.test(argument) ? argument : JSON.stringify(argument)))
		.join(" ");
}

function buildCommandErrorMessage(result: HwCommandResult): string {
	const output = result.stderr || result.stdout || "Command failed without output.";
	return [
		`Hardware command failed with exit code ${result.exitCode}.`,
		`Command: ${result.commandString}`,
		output,
	].join("\n");
}

function appendField(record: Record<string, string | string[]>, key: string, value: string): void {
	const existingValue = record[key];
	if (existingValue === undefined) {
		record[key] = value;
		return;
	}

	if (Array.isArray(existingValue)) {
		if (!existingValue.includes(value)) {
			existingValue.push(value);
		}
		return;
	}

	if (existingValue !== value) {
		record[key] = [existingValue, value];
	}
}

function resolveAvailableManifestDependencyCommand(dependencyId: HwDependencyId): string | null {
	const dependency = $manifest.refreshDependency(dependencyId);
	if (!dependency.available) {
		return null;
	}

	return dependency.resolvedPath ?? dependency.resolvedBinary ?? dependency.binary;
}

function createExecutableSnapshot(): HwResolvedExecutables {
	return {
		lspci: resolveAvailableManifestDependencyCommand("lspci"),
		lsmod: resolveAvailableManifestDependencyCommand("lsmod"),
		lsusb: resolveAvailableManifestDependencyCommand("lsusb"),
		modinfo: resolveAvailableManifestDependencyCommand("modinfo"),
		modprobe: resolveAvailableManifestDependencyCommand("modprobe"),
		rmmod: resolveAvailableManifestDependencyCommand("rmmod"),
		sudo: resolveAvailableManifestDependencyCommand("sudo"),
	};
}

function splitPciBlocks(value: string): string[][] {
	const blocks: string[][] = [];
	let currentBlock: string[] = [];

	for (const rawLine of value.split(/\r?\n/gu)) {
		if (rawLine.trim().length === 0) {
			if (currentBlock.length > 0) {
				blocks.push(currentBlock);
				currentBlock = [];
			}
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

	return blocks;
}

function parsePciHeader(line: string): Omit<HwPciDevice, "kernelDriverInUse" | "kernelModules" | "properties" | "rawBlock" | "rawLines" | "subsystem"> {
	const trimmedLine = line.trim();
	const separatorIndex = trimmedLine.indexOf(" ");
	const address = separatorIndex >= 0 ? trimmedLine.slice(0, separatorIndex).trim() : trimmedLine;
	const remainder = separatorIndex >= 0 ? trimmedLine.slice(separatorIndex + 1).trim() : "";
	const headerMatch = remainder.match(/^(?<className>.+?)\s+\[(?<classCode>[0-9a-fA-F]{4})\]:\s+(?<description>.+)$/u);
	const className = normalizeOptionalString(headerMatch?.groups?.className) ?? remainder;
	const classCode = normalizeOptionalString(headerMatch?.groups?.classCode);
	let description = normalizeOptionalString(headerMatch?.groups?.description) ?? remainder;
	let revision: string | null = null;

	const revisionMatch = description.match(/\(rev\s+([^)]+)\)\s*$/u);
	if (revisionMatch?.[1]) {
		revision = revisionMatch[1].trim();
		description = description.replace(/\s*\(rev\s+[^)]+\)\s*$/u, "").trim();
	}

	const vendorDeviceMatches = [...description.matchAll(/\[([0-9a-fA-F]{4}:[0-9a-fA-F]{4})\]/gu)];
	const vendorDeviceId = vendorDeviceMatches.length > 0
		? normalizeOptionalString(vendorDeviceMatches[vendorDeviceMatches.length - 1]?.[1])
		: null;

	return {
		address,
		className,
		classCode,
		description,
		revision,
		vendorDeviceId,
	};
}

function parsePciDevices(value: string): HwPciDevice[] {
	return splitPciBlocks(value).map((block) => {
		const header = parsePciHeader(block[0] ?? "");
		const properties: Record<string, string> = {};
		let kernelDriverInUse: string | null = null;
		let subsystem: string | null = null;
		let kernelModules: string[] = [];

		for (const rawLine of block.slice(1)) {
			const trimmedLine = rawLine.trim();
			const separatorIndex = trimmedLine.indexOf(":");
			if (separatorIndex < 0) {
				continue;
			}

			const key = trimmedLine.slice(0, separatorIndex).trim();
			const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
			properties[key] = rawValue;

			if (key === "Kernel driver in use") {
				kernelDriverInUse = normalizeOptionalString(rawValue);
				continue;
			}

			if (key === "Kernel modules") {
				kernelModules = splitCommaSeparated(rawValue);
				continue;
			}

			if (key === "Subsystem") {
				subsystem = normalizeOptionalString(rawValue);
			}
		}

		return {
			...header,
			subsystem,
			kernelDriverInUse,
			kernelModules,
			properties,
			rawBlock: block.join("\n"),
			rawLines: [...block],
		};
	});
}

function parseUsbDevices(value: string): HwUsbDevice[] {
	return splitNonEmptyLines(value)
		.map((line) => {
			const match = line.match(/^Bus\s+(?<bus>\d{3})\s+Device\s+(?<device>\d{3}):\s+ID\s+(?<vendorId>[0-9a-fA-F]{4}):(?<productId>[0-9a-fA-F]{4})\s*(?<description>.*)$/u);
			if (!match?.groups) {
				return null;
			}

			const bus = match.groups.bus;
			const device = match.groups.device;
			const vendorId = match.groups.vendorId;
			const productId = match.groups.productId;
			return {
				bus,
				device,
				vendorId,
				productId,
				id: `${vendorId}:${productId}`,
				description: normalizeOptionalString(match.groups.description),
				rawLine: line,
			};
		})
		.filter((device): device is HwUsbDevice => Boolean(device));
}

function parseLoadedModules(value: string): HwLoadedModule[] {
	const lines = splitNonEmptyLines(value);
	if (lines.length === 0) {
		return [];
	}

	return lines.slice(1)
		.map((line) => {
			const parts = line.trim().split(/\s+/u);
			if (parts.length < 3) {
				return null;
			}

			const moduleName = parts[0] ?? "";
			const sizeText = parts[1] ?? "0";
			const usedByCountText = parts[2] ?? "0";
			const dependentsText = parts.slice(3).join(" ").trim();
			const usedBy = dependentsText.length > 0 && dependentsText !== "-"
				? dependentsText.split(",").map((entry) => entry.trim()).filter(Boolean)
				: [];

			return {
				name: moduleName,
				size: Number.parseInt(sizeText, 10) || 0,
				usedByCount: Number.parseInt(usedByCountText, 10) || usedBy.length,
				usedBy,
				rawLine: line,
			};
		})
		.filter((module): module is HwLoadedModule => Boolean(module));
}

function parseModuleParameter(value: string): HwModuleParameter {
	const separatorIndex = value.indexOf(":");
	if (separatorIndex < 0) {
		return {
			name: value.trim(),
			description: "",
			raw: value,
		};
	}

	return {
		name: value.slice(0, separatorIndex).trim(),
		description: value.slice(separatorIndex + 1).trim(),
		raw: value,
	};
}

function parseModuleInfo(name: string, value: string): HwModuleInfo {
	const fields: Record<string, string | string[]> = {};
	const license: string[] = [];
	const aliases: string[] = [];
	const firmware: string[] = [];
	const parameters: HwModuleParameter[] = [];
	let filename: string | null = null;
	let description: string | null = null;
	let depends: string[] = [];

	for (const line of splitNonEmptyLines(value)) {
		const separatorIndex = line.indexOf(":");
		if (separatorIndex < 0) {
			continue;
		}

		const key = line.slice(0, separatorIndex).trim().toLowerCase();
		const rawValue = line.slice(separatorIndex + 1).trim();
		appendField(fields, key, rawValue);

		if (key === "filename") {
			filename = normalizeOptionalString(rawValue);
			continue;
		}

		if (key === "description") {
			description = normalizeOptionalString(rawValue);
			continue;
		}

		if (key === "license") {
			license.push(rawValue);
			continue;
		}

		if (key === "alias") {
			aliases.push(rawValue);
			continue;
		}

		if (key === "firmware") {
			firmware.push(rawValue);
			continue;
		}

		if (key === "depends") {
			depends = splitCommaSeparated(rawValue);
			continue;
		}

		if (key === "parm") {
			parameters.push(parseModuleParameter(rawValue));
		}
	}

	return {
		name,
		filename,
		description,
		license: uniqueStrings(license),
		aliases: uniqueStrings(aliases),
		depends,
		firmware: uniqueStrings(firmware),
		parameters,
		fields,
		raw: value,
	};
}

async function readInstalledModuleNames(modulesDirectory: string): Promise<Set<string>> {
	const modulesDepPath = path.join(modulesDirectory, "modules.dep");
	let content = "";
	try {
		content = await fs.readFile(modulesDepPath, "utf8");
	} catch {
		return new Set<string>();
	}

	const moduleNames = new Set<string>();
	for (const line of splitNonEmptyLines(content)) {
		const separatorIndex = line.indexOf(":");
		if (separatorIndex < 0) {
			continue;
		}

		const modulePath = line.slice(0, separatorIndex).trim();
		if (modulePath.length === 0) {
			continue;
		}

		const moduleName = stripModuleFileSuffix(path.basename(modulePath));
		if (moduleName.length > 0) {
			moduleNames.add(normalizeModuleToken(moduleName));
		}
	}

	return moduleNames;
}

function buildPackageHints(_device: HwPciDevice, _hostInfo: HwHostInfo): HwDriverSuggestion["packageHints"] {
	return [];
}

export class HwKit extends Kit {
	private hostInfo: HwHostInfo = {
		platform: process.platform,
		distro: {
			id: null,
			idLike: [],
			name: null,
			prettyName: null,
			versionId: null,
		},
		archCompatible: false,
		isRoot: false,
		originalUser: null,
		kernelRelease: os.release(),
		modulesDirectory: path.join("/lib/modules", os.release()),
		executables: createExecutableSnapshot(),
	};

	constructor() {
		super({
			id: HW_KIT_ID,
			name: "Hardware Kit",
			description: "Inspect host PCI/USB devices and loaded kernel modules.",
		});
	}

	protected override async onStart(_context: KitLifecycleContext): Promise<void> {
		const distro = await readLinuxDistroInfo();
		const kernelRelease = os.release();
		this.hostInfo = {
			platform: process.platform,
			distro,
			archCompatible: isArchCompatibleDistro(distro),
			isRoot: typeof process.getuid === "function" ? process.getuid() === 0 : false,
			originalUser: normalizeOptionalString(process.env.SUDO_USER) ?? normalizeOptionalString(process.env.USER),
			kernelRelease,
			modulesDirectory: path.join("/lib/modules", kernelRelease),
			executables: createExecutableSnapshot(),
		};
	}

	getHostInfo(): HwHostInfo {
		return structuredClone(this.hostInfo);
	}

	async listPciDevices(): Promise<HwPciListResult> {
		const result = await this.runDependencyCommand("lspci", ["-D", "-nnk"]);
		return {
			...result,
			host: this.getHostInfo(),
			devices: parsePciDevices(result.stdout),
		};
	}

	async listUsbDevices(): Promise<HwUsbListResult> {
		const result = await this.runDependencyCommand("lsusb", []);
		return {
			...result,
			host: this.getHostInfo(),
			devices: parseUsbDevices(result.stdout),
		};
	}

	async listLoadedModules(): Promise<HwLoadedModulesResult> {
		const result = await this.runDependencyCommand("lsmod", []);
		return {
			...result,
			host: this.getHostInfo(),
			modules: parseLoadedModules(result.stdout),
		};
	}

	async findDriverForDevice(address: string): Promise<HwDriverLookupResult> {
		const normalizedAddress = normalizeRequiredString(address, "address");
		const result = await this.runDependencyCommand("lspci", ["-D", "-nnk", "-s", normalizedAddress], { allowFailure: true });
		const devices = parsePciDevices(result.stdout);
		return {
			...result,
			host: this.getHostInfo(),
			address: normalizedAddress,
			found: devices.length > 0,
			device: devices[0] ?? null,
		};
	}

	async getModuleInfo(name: string): Promise<HwModuleInfoResult> {
		const normalizedName = normalizeRequiredString(name, "name");
		const result = await this.runDependencyCommand("modinfo", [normalizedName], { allowFailure: true });
		const found = result.exitCode === 0 && result.stdout.trim().length > 0;
		return {
			...result,
			host: this.getHostInfo(),
			name: normalizedName,
			found,
			info: found ? parseModuleInfo(normalizedName, result.stdout) : null,
		};
	}

	async loadModule(name: string, options: HwModuleLoadOptions = {}): Promise<HwModuleMutationResult> {
		const normalizedName = normalizeRequiredString(name, "name");
		const requestedParams = parseModuleParams(options.params);
		const before = await this.findLoadedModule(normalizedName);
		const commandResult = await this.runDependencyCommand("modprobe", [normalizedName, ...requestedParams], { mutating: true });
		const after = await this.findLoadedModule(normalizedName);
		return {
			action: "load",
			host: this.getHostInfo(),
			name: normalizedName,
			requestedParams,
			force: false,
			beforeLoaded: before !== null,
			afterLoaded: after !== null,
			skipped: false,
			commandResults: [commandResult],
			before,
			after,
		};
	}

	async unloadModule(name: string, options: HwModuleUnloadOptions = {}): Promise<HwModuleMutationResult> {
		const normalizedName = normalizeRequiredString(name, "name");
		const force = normalizeBoolean(options.force);
		const before = await this.findLoadedModule(normalizedName);
		if (!before) {
			return {
				action: "unload",
				host: this.getHostInfo(),
				name: normalizedName,
				requestedParams: [],
				force,
				beforeLoaded: false,
				afterLoaded: false,
				skipped: true,
				commandResults: [],
				before: null,
				after: null,
			};
		}

		const commandResult = await this.runDependencyCommand("rmmod", [...(force ? ["-f"] : []), normalizedName], { mutating: true });
		const after = await this.findLoadedModule(normalizedName);
		return {
			action: "unload",
			host: this.getHostInfo(),
			name: normalizedName,
			requestedParams: [],
			force,
			beforeLoaded: true,
			afterLoaded: after !== null,
			skipped: false,
			commandResults: [commandResult],
			before,
			after,
		};
	}

	async reloadModule(name: string, options: HwModuleReloadOptions = {}): Promise<HwModuleMutationResult> {
		const normalizedName = normalizeRequiredString(name, "name");
		const requestedParams = parseModuleParams(options.params);
		const force = normalizeBoolean(options.force);
		const before = await this.findLoadedModule(normalizedName);
		const commandResults: HwCommandResult[] = [];

		if (before) {
			commandResults.push(
				await this.runDependencyCommand("rmmod", [...(force ? ["-f"] : []), normalizedName], { mutating: true }),
			);
		}

		commandResults.push(
			await this.runDependencyCommand("modprobe", [normalizedName, ...requestedParams], { mutating: true }),
		);
		const after = await this.findLoadedModule(normalizedName);
		return {
			action: "reload",
			host: this.getHostInfo(),
			name: normalizedName,
			requestedParams,
			force,
			beforeLoaded: before !== null,
			afterLoaded: after !== null,
			skipped: false,
			commandResults,
			before,
			after,
		};
	}

	async suggestDrivers(): Promise<HwSuggestResult> {
		const pciResult = await this.listPciDevices();
		const availableModuleNames = await readInstalledModuleNames(this.hostInfo.modulesDirectory);
		const suggestions = pciResult.devices.map((device) => {
			const installedCandidateModules = device.kernelModules.filter((moduleName) => availableModuleNames.has(normalizeModuleToken(moduleName)));
			const status: HwDriverSuggestion["status"] = device.kernelDriverInUse
				? "bound"
				: installedCandidateModules.length > 0
					? "candidate-module"
					: "unknown";

			return {
				address: device.address,
				className: device.className,
				description: device.description,
				currentDriver: device.kernelDriverInUse,
				candidateModules: [...device.kernelModules],
				installedCandidateModules,
				status,
				packageHints: buildPackageHints(device, pciResult.host),
				rawBlock: device.rawBlock,
			};
		});

		return {
			host: pciResult.host,
			kernelRelease: this.hostInfo.kernelRelease,
			modulesDirectory: this.hostInfo.modulesDirectory,
			availableModuleCount: availableModuleNames.size,
			suggestions,
		};
	}

	private assertLinux(): void {
		if (this.hostInfo.platform !== "linux") {
			throw new Error(`HwKit supports only Linux hosts. Current platform: ${this.hostInfo.platform}.`);
		}
	}

	private resolveDependencyCommand(id: HwDependencyId, reason: string): string {
		const command = $manifest.resolveDependencyCommand(id, reason);
		this.hostInfo.executables[id] = command;
		return command;
	}

	private async findLoadedModule(name: string): Promise<HwLoadedModule | null> {
		const normalizedName = normalizeModuleToken(name);
		const modulesResult = await this.listLoadedModules();
		return modulesResult.modules.find((module) => normalizeModuleToken(module.name) === normalizedName) ?? null;
	}

	private buildPrivilegedCommand(command: readonly string[]): string[] {
		if (this.hostInfo.isRoot) {
			return [...command];
		}

		const sudoCommand = this.resolveDependencyCommand(
			"sudo",
			"HwKit mutating operations require sudo when the current process is not running as root",
		);
		return [sudoCommand, "-n", ...command];
	}

	private async runDependencyCommand(
		id: Exclude<HwDependencyId, "sudo">,
		args: readonly string[],
		options: { allowFailure?: boolean; mutating?: boolean } = {},
	): Promise<HwCommandResult> {
		this.assertLinux();
		const executable = this.resolveDependencyCommand(id, `HwKit requires '${id}' to inspect host hardware state`);
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

		const result: HwCommandResult = {
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