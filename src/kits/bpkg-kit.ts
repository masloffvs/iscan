import fs from "node:fs/promises";
import { Buffer } from "node:buffer";
import path from "node:path";

import {
	getBpkgBindingDefinition,
	getRegisteredBpkgPackage,
	listRegisteredBpkgPackages,
	normalizeBpkgBindingParams,
	type BpkgBindingRuntimeBridge,
	type BpkgPrivilegeLevel,
	type BpkgSupportedPackageSummary,
	type BpkgTranspiledCommand,
} from "../bpkg";
import { emitExecutionLogChunk } from "../execution-log";
import { $manifest } from "../manifest";
import { resolveWritableRuntimePath } from "../runtime-paths";
import { isArchCompatibleDistro, readLinuxDistroInfo, type LinuxDistroInfo } from "../utils/distro-detection";
import { Kit, type KitLifecycleContext } from "./kit";

export const BPKG_KIT_ID = "bpkg";

const BWRAP_DEPENDENCY_ID = "bwrap";
const PACSTRAP_DEPENDENCY_ID = "pacstrap";
const SUDO_DEPENDENCY_ID = "sudo";
const SYSTEMD_NSPAWN_DEPENDENCY_ID = "systemd-nspawn";

const BPKG_PRIVILEGE_LEVELS: readonly BpkgPrivilegeLevel[] = ["sandbox-ro", "sandbox-rw", "host-privileged"];
const DEFAULT_BPKG_PRIVILEGE_LEVEL: BpkgPrivilegeLevel = "sandbox-ro";
const DEFAULT_BPKG_ALLOWED_PRIVILEGE_LEVELS: readonly BpkgPrivilegeLevel[] = ["sandbox-ro", "sandbox-rw"];
const HOST_PRIVILEGED_CAPABILITIES = ["CAP_SYS_ADMIN", "CAP_NET_ADMIN", "CAP_NET_RAW"] as const;
const BPKG_ERROR_OUTPUT_MAX_LENGTH = 2048;
const BPKG_ERROR_OUTPUT_MAX_LINES = 18;
const BPKG_BOX_POLICY_BOOLEAN_KEYS = [
	"allowHostPrivileged",
	"allowSandboxRw",
	"defaultSandboxRw",
	"hostDev",
	"hostProc",
	"hostSys",
	"shareNetwork",
	"unshareUser",
	"unshareIpc",
	"unsharePid",
	"unshareUts",
	"unshareCgroup",
] as const;
const BPKG_SANDBOX_SYS_MODES = ["off", "host-ro", "host-rw", "sysfs"] as const;
const BPKG_SANDBOX_DEV_MODES = ["sandbox", "host"] as const;
const BPKG_SANDBOX_PROC_MODES = ["sandbox", "host-ro", "host-rw"] as const;
const BPKG_SANDBOX_BIND_MOUNT_MODES = ["ro-bind", "bind", "dev-bind"] as const;
const DEFAULT_BPKG_SANDBOX_POLICY_EXTENSIONS = {
	devMode: "sandbox",
	procMode: "sandbox",
	shareNetwork: true,
	sysMode: "off",
} as const;

export type BpkgBoxStatus = "missing" | "building" | "ready" | "error";

export type { BpkgPrivilegeLevel } from "../bpkg";

type BpkgBoxPolicyBooleanKey = (typeof BPKG_BOX_POLICY_BOOLEAN_KEYS)[number];

export type BpkgSandboxSysMode = (typeof BPKG_SANDBOX_SYS_MODES)[number];
export type BpkgSandboxDevMode = (typeof BPKG_SANDBOX_DEV_MODES)[number];
export type BpkgSandboxProcMode = (typeof BPKG_SANDBOX_PROC_MODES)[number];
export type BpkgSandboxBindMountMode = (typeof BPKG_SANDBOX_BIND_MOUNT_MODES)[number];

export type BpkgSandboxBindMount = {
	mode: BpkgSandboxBindMountMode;
	source: string;
	target: string;
};

export type BpkgSandboxPolicyExtensions = {
	devMode: BpkgSandboxDevMode;
	extraBindMounts: BpkgSandboxBindMount[];
	procMode: BpkgSandboxProcMode;
	shareNetwork: boolean;
	sysMode: BpkgSandboxSysMode;
};

export type BpkgSandboxPolicyExtensionsInput = {
	devMode?: BpkgSandboxDevMode;
	extraBindMounts?: readonly BpkgSandboxBindMount[];
	procMode?: BpkgSandboxProcMode;
	shareNetwork?: boolean;
	sysMode?: BpkgSandboxSysMode;
};

export type BpkgBoxPrivilegeConfig = {
	allowHostPrivileged: boolean;
	allowSandboxRw: boolean;
	defaultSandboxRw: boolean;
	hostDev: boolean;
	hostProc: boolean;
	hostSys: boolean;
	shareNetwork: boolean;
	unshareUser: boolean;
	unshareIpc: boolean;
	unsharePid: boolean;
	unshareUts: boolean;
	unshareCgroup: boolean;
	// Legacy compatibility fields kept at runtime while callers migrate.
	allowedPrivilegeLevels: BpkgPrivilegeLevel[];
	defaultPrivilegeLevel: BpkgPrivilegeLevel;
	sandboxPolicyExtensions: BpkgSandboxPolicyExtensions;
};

export type BpkgHostInfo = {
	archCompatible: boolean;
	bwrapExecutable: string | null;
	distro: LinuxDistroInfo;
	isRoot: boolean;
	nspawnExecutable: string | null;
	pacstrapExecutable: string | null;
	platform: NodeJS.Platform;
	sudoExecutable: string | null;
};

export type BpkgBoxRecord = {
	allowHostPrivileged: boolean;
	allowSandboxRw: boolean;
	createdAt: number;
	defaultSandboxRw: boolean;
	description?: string;
	id: string;
	hostDev: boolean;
	hostProc: boolean;
	hostSys: boolean;
	lastError?: string;
	name: string;
	packages: string[];
	shareNetwork: boolean;
	unshareUser: boolean;
	unshareIpc: boolean;
	unsharePid: boolean;
	unshareUts: boolean;
	unshareCgroup: boolean;
	allowedPrivilegeLevels: BpkgPrivilegeLevel[];
	defaultPrivilegeLevel: BpkgPrivilegeLevel;
	sandboxPolicyExtensions: BpkgSandboxPolicyExtensions;
	rootPath: string;
	status: BpkgBoxStatus;
	updatedAt: number;
};

export type BpkgCommandResult = {
	boxId: string;
	command: string[];
	commandString: string;
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type BpkgBindingExecutionResult = BpkgCommandResult & {
	bindingId: string;
	parsed?: unknown;
	packageId: string;
	transpiled: BpkgTranspiledCommand;
};

type BpkgCommandStreamHandlers = {
	onStderrChunk?: (chunk: string) => void | Promise<void>;
	onStdoutChunk?: (chunk: string) => void | Promise<void>;
};

type ExecutePackageBindingOptions = {
	commandHandlers?: BpkgCommandStreamHandlers;
	privilegeLevel?: BpkgPrivilegeLevel;
	runtime?: BpkgBindingRuntimeBridge;
};

export type BpkgInstallResult = {
	box: BpkgBoxRecord;
	commandResults: BpkgCommandResult[];
	packageIds: string[];
	pacmanPackages: string[];
	paruPackages: string[];
};

export type BpkgListResult = {
	boxes: BpkgBoxRecord[];
	defaultBoxId: string | null;
	hostInfo: BpkgHostInfo;
};

export type BpkgTerminalSession = {
	box: BpkgBoxRecord;
	child: ReturnType<typeof Bun.spawn>;
	cols: number;
	command: string[];
	commandString: string;
	rows: number;
	write: (data: string | Uint8Array) => Promise<void>;
	close: () => Promise<void>;
};

type PersistedBpkgBoxRecord = Omit<BpkgBoxRecord, "allowedPrivilegeLevels" | "defaultPrivilegeLevel" | "sandboxPolicyExtensions">;

type PersistedBpkgRegistry = {
	boxes: PersistedBpkgBoxRecord[];
	defaultBoxId: string | null;
};

type RuntimeBpkgRegistry = {
	boxes: BpkgBoxRecord[];
	defaultBoxId: string | null;
};

type BpkgBoxPrivilegeConfigInput = Partial<Record<BpkgBoxPolicyBooleanKey, unknown>> & {
	allowedPrivilegeLevels?: readonly BpkgPrivilegeLevel[];
	defaultPrivilegeLevel?: BpkgPrivilegeLevel;
	sandboxPolicyExtensions?: BpkgSandboxPolicyExtensionsInput;
};

type CreateBoxOptions = BpkgBoxPrivilegeConfigInput & {
	description?: string;
	id?: string;
	name?: string;
	packages?: readonly string[];
};

type ExecuteBoxCommandOptions = {
	argv?: readonly string[];
	command?: string;
	cwd?: string;
	env?: Record<string, string>;
	privilegeLevel?: BpkgPrivilegeLevel;
	writableRoot?: boolean;
	useDefaultBox?: boolean;
};

type BoxCommandExecution = {
	argv: string[];
	box: BpkgBoxRecord;
	privilegeLevel: BpkgPrivilegeLevel;
	runner: HostRunner;
};

type OpenBoxTerminalOptions = {
	cols?: number;
	privilegeLevel?: BpkgPrivilegeLevel;
	rows?: number;
};

type SetBoxPrivilegeOptions = BpkgBoxPrivilegeConfigInput;

type HostRunner = "bwrap" | "pacstrap" | "nspawn";

export class BpkgCommandError extends Error {
	constructor(public readonly result: BpkgCommandResult) {
		super(formatBpkgCommandFailureMessage(result));
		this.name = "BpkgCommandError";
	}
}

export class BpkgUnsupportedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BpkgUnsupportedError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
	handler?: ((chunk: string) => void | Promise<void>) | undefined,
	streamName?: "stdout" | "stderr",
): Promise<string> {
	if (!stream) {
		return "";
	}

	if (!handler && !streamName) {
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
				if (streamName) {
					emitExecutionLogChunk({ stream: streamName, chunk });
				}

				if (handler) {
					await handler(chunk);
				}
			}
		}

		const tail = decoder.decode();
		output += tail;
		if (tail.length > 0) {
			if (streamName) {
				emitExecutionLogChunk({ stream: streamName, chunk: tail });
			}

			if (handler) {
				await handler(tail);
			}
		}
	} finally {
		reader.releaseLock();
	}

	return output.trim();
}

function formatCommand(command: readonly string[]): string {
	return command
		.map((argument) => (/^[A-Za-z0-9_./:=+-]+$/u.test(argument) ? argument : JSON.stringify(argument)))
		.join(" ");
}

function formatShellCommand(command: readonly string[]): string {
	return command
		.map((argument) => (/^[A-Za-z0-9_./:=+-]+$/u.test(argument) ? argument : `'${argument.replace(/'/gu, `'"'"'`)}'`))
		.join(" ");
}

function trimDiagnosticText(
	value: string,
	options: { maxLength?: number; maxLines?: number } = {},
): string {
	const normalized = value.replace(/\r\n?/gu, "\n").trim();
	if (normalized.length === 0) {
		return "";
	}

	const maxLength = options.maxLength ?? BPKG_ERROR_OUTPUT_MAX_LENGTH;
	const maxLines = options.maxLines ?? BPKG_ERROR_OUTPUT_MAX_LINES;
	const sourceLines = normalized.split("\n");
	let nextValue = normalized;
	let wasTrimmed = false;

	if (sourceLines.length > maxLines) {
		nextValue = sourceLines.slice(0, maxLines).join("\n");
		wasTrimmed = true;
	}

	if (nextValue.length > maxLength) {
		nextValue = nextValue.slice(0, maxLength).trimEnd();
		wasTrimmed = true;
	}

	return wasTrimmed ? `${nextValue}\n... [output trimmed]` : nextValue;
}

function formatBpkgCommandFailureMessage(result: BpkgCommandResult): string {
	return [
		`bpkg command failed with exit code ${result.exitCode}.`,
		`Command: ${result.commandString}`,
		trimDiagnosticText(result.stderr || result.stdout || "bpkg command failed without output."),
	].join("\n");
}

function formatPersistedBoxError(error: unknown): string {
	if (error instanceof BpkgCommandError) {
		return trimDiagnosticText(error.message);
	}

	if (error instanceof Error) {
		return trimDiagnosticText(error.message);
	}

	return trimDiagnosticText(String(error));
}

function decodeMountInfoPath(value: string): string {
	return value
		.replace(/\\040/gu, " ")
		.replace(/\\011/gu, "\t")
		.replace(/\\012/gu, "\n")
		.replace(/\\134/gu, "\\");
}

function listMountedPathsWithin(content: string, rootPath: string): string[] {
	const normalizedRootPath = path.resolve(rootPath);
	const nestedPrefix = `${normalizedRootPath}${path.sep}`;
	return [...new Set(
		content
			.split(/\r?\n/gu)
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => decodeMountInfoPath(line.split(" ")[4] ?? ""))
			.filter((mountPath) => mountPath === normalizedRootPath || mountPath.startsWith(nestedPrefix)),
	)]
		.sort((left, right) => right.length - left.length);
}

function normalizeString(value: unknown, fieldName: string): string {
	if (typeof value !== "string") {
		throw new Error(`${fieldName} must be a string.`);
	}

	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new Error(`${fieldName} must be a non-empty string.`);
	}

	return normalized;
}

function normalizeOptionalString(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	return normalizeString(value, fieldName);
}

function normalizeOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value !== "boolean") {
		throw new Error(`${fieldName} must be a boolean.`);
	}

	return value;
}

function normalizeStringArray(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function slugifyBoxId(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");

	if (slug.length === 0) {
		throw new Error("bpkg box id cannot be empty.");
	}

	return slug;
}

function cloneBox(box: BpkgBoxRecord): BpkgBoxRecord {
	return {
		...box,
		allowHostPrivileged: box.allowHostPrivileged,
		allowSandboxRw: box.allowSandboxRw,
		allowedPrivilegeLevels: [...box.allowedPrivilegeLevels],
		defaultSandboxRw: box.defaultSandboxRw,
		packages: [...box.packages],
		hostDev: box.hostDev,
		hostProc: box.hostProc,
		hostSys: box.hostSys,
		shareNetwork: box.shareNetwork,
		unshareUser: box.unshareUser,
		unshareIpc: box.unshareIpc,
		unsharePid: box.unsharePid,
		unshareUts: box.unshareUts,
		unshareCgroup: box.unshareCgroup,
		sandboxPolicyExtensions: cloneSandboxPolicyExtensions(box.sandboxPolicyExtensions),
	};
}

function createDefaultBpkgBoxPrivilegeConfig(): BpkgBoxPrivilegeConfig {
	return {
		allowHostPrivileged: false,
		allowSandboxRw: true,
		allowedPrivilegeLevels: [...DEFAULT_BPKG_ALLOWED_PRIVILEGE_LEVELS],
		defaultPrivilegeLevel: DEFAULT_BPKG_PRIVILEGE_LEVEL,
		defaultSandboxRw: false,
		hostDev: false,
		hostProc: false,
		hostSys: false,
		shareNetwork: true,
		unshareUser: true,
		unshareIpc: true,
		unsharePid: true,
		unshareUts: true,
		unshareCgroup: true,
		sandboxPolicyExtensions: createDefaultSandboxPolicyExtensions(),
	};
}

function listAllowedBpkgPrivilegeLevels(value: Pick<BpkgBoxPrivilegeConfig, "allowHostPrivileged" | "allowSandboxRw">): BpkgPrivilegeLevel[] {
	return [
		"sandbox-ro",
		...(value.allowSandboxRw ? ["sandbox-rw" as const] : []),
		...(value.allowHostPrivileged ? ["host-privileged" as const] : []),
	];
}

function createLegacySandboxPolicyExtensions(value: Pick<BpkgBoxPrivilegeConfig, "hostDev" | "hostProc" | "hostSys" | "shareNetwork">): BpkgSandboxPolicyExtensions {
	return {
		devMode: value.hostDev ? "host" : "sandbox",
		extraBindMounts: [],
		procMode: value.hostProc ? "host-ro" : "sandbox",
		shareNetwork: value.shareNetwork,
		sysMode: value.hostSys ? "host-ro" : "off",
	};
}

function hydrateLegacyPrivilegeCompatibility(value: Pick<BpkgBoxPrivilegeConfig, BpkgBoxPolicyBooleanKey>): Pick<BpkgBoxPrivilegeConfig, "allowedPrivilegeLevels" | "defaultPrivilegeLevel" | "sandboxPolicyExtensions"> {
	return {
		allowedPrivilegeLevels: listAllowedBpkgPrivilegeLevels(value),
		defaultPrivilegeLevel: value.defaultSandboxRw ? "sandbox-rw" : "sandbox-ro",
		sandboxPolicyExtensions: createLegacySandboxPolicyExtensions(value),
	};
}

function extractFlatBpkgBoxPrivilegeConfig(value: Pick<BpkgBoxPrivilegeConfig, BpkgBoxPolicyBooleanKey>): Pick<BpkgBoxPrivilegeConfig, BpkgBoxPolicyBooleanKey> {
	return {
		allowHostPrivileged: value.allowHostPrivileged,
		allowSandboxRw: value.allowSandboxRw,
		defaultSandboxRw: value.defaultSandboxRw,
		hostDev: value.hostDev,
		hostProc: value.hostProc,
		hostSys: value.hostSys,
		shareNetwork: value.shareNetwork,
		unshareUser: value.unshareUser,
		unshareIpc: value.unshareIpc,
		unsharePid: value.unsharePid,
		unshareUts: value.unshareUts,
		unshareCgroup: value.unshareCgroup,
	};
}

function hasFlatBpkgBoxPolicyInput(value: unknown): value is Partial<Record<BpkgBoxPolicyBooleanKey, unknown>> {
	if (!isRecord(value)) {
		return false;
	}

	return BPKG_BOX_POLICY_BOOLEAN_KEYS.some((key) => key in value);
}

function hasLegacyBpkgBoxPolicyInput(
	value: unknown,
): value is { allowedPrivilegeLevels?: unknown; defaultPrivilegeLevel?: unknown; sandboxPolicyExtensions?: unknown } {
	return isRecord(value)
		&& ("allowedPrivilegeLevels" in value || "defaultPrivilegeLevel" in value || "sandboxPolicyExtensions" in value);
}

function isBpkgPrivilegeLevel(value: string): value is BpkgPrivilegeLevel {
	return BPKG_PRIVILEGE_LEVELS.includes(value as BpkgPrivilegeLevel);
}

function normalizeBpkgPrivilegeLevel(value: unknown, fieldName: string): BpkgPrivilegeLevel {
	const normalized = normalizeString(value, fieldName);
	if (!isBpkgPrivilegeLevel(normalized)) {
		throw new Error(`${fieldName} must be one of: ${BPKG_PRIVILEGE_LEVELS.join(", ")}.`);
	}

	return normalized;
}

function normalizeOptionalBpkgPrivilegeLevel(value: unknown, fieldName: string): BpkgPrivilegeLevel | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	return normalizeBpkgPrivilegeLevel(value, fieldName);
}

function isBpkgSandboxSysMode(value: string): value is BpkgSandboxSysMode {
	return BPKG_SANDBOX_SYS_MODES.includes(value as BpkgSandboxSysMode);
}

function isBpkgSandboxDevMode(value: string): value is BpkgSandboxDevMode {
	return BPKG_SANDBOX_DEV_MODES.includes(value as BpkgSandboxDevMode);
}

function isBpkgSandboxProcMode(value: string): value is BpkgSandboxProcMode {
	return BPKG_SANDBOX_PROC_MODES.includes(value as BpkgSandboxProcMode);
}

function isBpkgSandboxBindMountMode(value: string): value is BpkgSandboxBindMountMode {
	return BPKG_SANDBOX_BIND_MOUNT_MODES.includes(value as BpkgSandboxBindMountMode);
}

function normalizeAbsoluteSandboxPath(value: unknown, fieldName: string): string {
	const normalized = normalizeString(value, fieldName);
	if (!normalized.startsWith("/")) {
		throw new Error(`${fieldName} must be an absolute path.`);
	}

	return normalized;
}

function normalizeOptionalBpkgSandboxSysMode(value: unknown, fieldName: string): BpkgSandboxSysMode | undefined {
	const normalized = normalizeOptionalString(value, fieldName);
	if (!normalized) {
		return undefined;
	}

	if (!isBpkgSandboxSysMode(normalized)) {
		throw new Error(`${fieldName} must be one of: ${BPKG_SANDBOX_SYS_MODES.join(", ")}.`);
	}

	return normalized;
}

function normalizeOptionalBpkgSandboxDevMode(value: unknown, fieldName: string): BpkgSandboxDevMode | undefined {
	const normalized = normalizeOptionalString(value, fieldName);
	if (!normalized) {
		return undefined;
	}

	if (!isBpkgSandboxDevMode(normalized)) {
		throw new Error(`${fieldName} must be one of: ${BPKG_SANDBOX_DEV_MODES.join(", ")}.`);
	}

	return normalized;
}

function normalizeOptionalBpkgSandboxProcMode(value: unknown, fieldName: string): BpkgSandboxProcMode | undefined {
	const normalized = normalizeOptionalString(value, fieldName);
	if (!normalized) {
		return undefined;
	}

	if (!isBpkgSandboxProcMode(normalized)) {
		throw new Error(`${fieldName} must be one of: ${BPKG_SANDBOX_PROC_MODES.join(", ")}.`);
	}

	return normalized;
}

function normalizeOptionalBpkgSandboxBindMountMode(value: unknown, fieldName: string): BpkgSandboxBindMountMode | undefined {
	const normalized = normalizeOptionalString(value, fieldName);
	if (!normalized) {
		return undefined;
	}

	if (!isBpkgSandboxBindMountMode(normalized)) {
		throw new Error(`${fieldName} must be one of: ${BPKG_SANDBOX_BIND_MOUNT_MODES.join(", ")}.`);
	}

	return normalized;
}

function createDefaultSandboxPolicyExtensions(): BpkgSandboxPolicyExtensions {
	return {
		devMode: DEFAULT_BPKG_SANDBOX_POLICY_EXTENSIONS.devMode,
		extraBindMounts: [],
		procMode: DEFAULT_BPKG_SANDBOX_POLICY_EXTENSIONS.procMode,
		shareNetwork: DEFAULT_BPKG_SANDBOX_POLICY_EXTENSIONS.shareNetwork,
		sysMode: DEFAULT_BPKG_SANDBOX_POLICY_EXTENSIONS.sysMode,
	};
}

function cloneSandboxPolicyExtensions(value: BpkgSandboxPolicyExtensions): BpkgSandboxPolicyExtensions {
	return {
		devMode: value.devMode,
		extraBindMounts: value.extraBindMounts.map((entry) => ({ ...entry })),
		procMode: value.procMode,
		shareNetwork: value.shareNetwork,
		sysMode: value.sysMode,
	};
}

function parseBpkgSandboxBindMount(value: unknown, fieldName: string): BpkgSandboxBindMount {
	if (!isRecord(value)) {
		throw new Error(`${fieldName} must be an object.`);
	}

	return {
		mode: normalizeOptionalBpkgSandboxBindMountMode(value.mode, `${fieldName}.mode`) ?? "ro-bind",
		source: normalizeAbsoluteSandboxPath(value.source, `${fieldName}.source`),
		target: normalizeAbsoluteSandboxPath(value.target, `${fieldName}.target`),
	};
}

export function parseBpkgSandboxPolicyExtensionsInput(
	value: unknown,
	fieldName = "sandboxPolicyExtensions",
): BpkgSandboxPolicyExtensionsInput {
	if (!isRecord(value)) {
		throw new Error(`${fieldName} must be an object.`);
	}

	const extraBindMounts = (() => {
		if (value.extraBindMounts === undefined || value.extraBindMounts === null) {
			return undefined;
		}

		if (!Array.isArray(value.extraBindMounts)) {
			throw new Error(`${fieldName}.extraBindMounts must be an array.`);
		}

		return value.extraBindMounts.map((entry, index) => parseBpkgSandboxBindMount(entry, `${fieldName}.extraBindMounts[${index}]`));
	})();

	const devMode = normalizeOptionalBpkgSandboxDevMode(value.devMode, `${fieldName}.devMode`);
	const procMode = normalizeOptionalBpkgSandboxProcMode(value.procMode, `${fieldName}.procMode`);
	const shareNetwork = normalizeOptionalBoolean(value.shareNetwork, `${fieldName}.shareNetwork`);
	const sysMode = normalizeOptionalBpkgSandboxSysMode(value.sysMode, `${fieldName}.sysMode`);

	return {
		...(devMode ? { devMode } : {}),
		...(extraBindMounts !== undefined ? { extraBindMounts } : {}),
		...(procMode ? { procMode } : {}),
		...(shareNetwork !== undefined ? { shareNetwork } : {}),
		...(sysMode ? { sysMode } : {}),
	};
}

function normalizeBpkgSandboxPolicyExtensions(value: unknown): BpkgSandboxPolicyExtensions {
	if (value === undefined || value === null || value === "") {
		return createDefaultSandboxPolicyExtensions();
	}

	const parsed = parseBpkgSandboxPolicyExtensionsInput(value);
	return {
		devMode: parsed.devMode ?? DEFAULT_BPKG_SANDBOX_POLICY_EXTENSIONS.devMode,
		extraBindMounts: parsed.extraBindMounts ? parsed.extraBindMounts.map((entry) => ({ ...entry })) : [],
		procMode: parsed.procMode ?? DEFAULT_BPKG_SANDBOX_POLICY_EXTENSIONS.procMode,
		shareNetwork: parsed.shareNetwork ?? DEFAULT_BPKG_SANDBOX_POLICY_EXTENSIONS.shareNetwork,
		sysMode: parsed.sysMode ?? DEFAULT_BPKG_SANDBOX_POLICY_EXTENSIONS.sysMode,
	};
}

function orderBpkgPrivilegeLevels(values: readonly BpkgPrivilegeLevel[]): BpkgPrivilegeLevel[] {
	const uniqueValues = new Set(values);
	return BPKG_PRIVILEGE_LEVELS.filter((value) => uniqueValues.has(value));
}

function createDefaultAllowedPrivilegeLevels(defaultPrivilegeLevel: BpkgPrivilegeLevel): BpkgPrivilegeLevel[] {
	return defaultPrivilegeLevel === "host-privileged"
		? [...BPKG_PRIVILEGE_LEVELS]
		: [...DEFAULT_BPKG_ALLOWED_PRIVILEGE_LEVELS];
}

function normalizeBpkgAllowedPrivilegeLevels(
	value: unknown,
	fieldName: string,
	defaultPrivilegeLevel: BpkgPrivilegeLevel,
): BpkgPrivilegeLevel[] {
	if (value === undefined || value === null || value === "") {
		return createDefaultAllowedPrivilegeLevels(defaultPrivilegeLevel);
	}

	if (!Array.isArray(value)) {
		throw new Error(`${fieldName} must be an array of privilege levels.`);
	}

	const normalized = orderBpkgPrivilegeLevels(
		value.map((entry, index) => normalizeBpkgPrivilegeLevel(entry, `${fieldName}[${index}]`)),
	);
	if (!normalized.includes(defaultPrivilegeLevel)) {
		normalized.push(defaultPrivilegeLevel);
	}

	return orderBpkgPrivilegeLevels(normalized);
}

function normalizeBpkgBoxPrivilegeConfig(
	value: BpkgBoxPrivilegeConfigInput,
	fallbackDefaultPrivilegeLevel: BpkgPrivilegeLevel = DEFAULT_BPKG_PRIVILEGE_LEVEL,
): BpkgBoxPrivilegeConfig {
	if (hasFlatBpkgBoxPolicyInput(value)) {
		return normalizeFlatBpkgBoxPrivilegeConfig(value);
	}

	if (hasLegacyBpkgBoxPolicyInput(value)) {
		return normalizeLegacyBpkgBoxPrivilegeConfig(value, fallbackDefaultPrivilegeLevel);
	}

	return createDefaultBpkgBoxPrivilegeConfig();
}

function normalizeFlatBpkgBoxPrivilegeConfig(
	value: Partial<Record<BpkgBoxPolicyBooleanKey, unknown>>,
): BpkgBoxPrivilegeConfig {
	const defaults = createDefaultBpkgBoxPrivilegeConfig();
	const normalized: Pick<BpkgBoxPrivilegeConfig, BpkgBoxPolicyBooleanKey> = {
		allowHostPrivileged: normalizeOptionalBoolean(value.allowHostPrivileged, "allowHostPrivileged") ?? defaults.allowHostPrivileged,
		allowSandboxRw: normalizeOptionalBoolean(value.allowSandboxRw, "allowSandboxRw") ?? defaults.allowSandboxRw,
		defaultSandboxRw: normalizeOptionalBoolean(value.defaultSandboxRw, "defaultSandboxRw") ?? defaults.defaultSandboxRw,
		hostDev: normalizeOptionalBoolean(value.hostDev, "hostDev") ?? defaults.hostDev,
		hostProc: normalizeOptionalBoolean(value.hostProc, "hostProc") ?? defaults.hostProc,
		hostSys: normalizeOptionalBoolean(value.hostSys, "hostSys") ?? defaults.hostSys,
		shareNetwork: normalizeOptionalBoolean(value.shareNetwork, "shareNetwork") ?? defaults.shareNetwork,
		unshareUser: normalizeOptionalBoolean(value.unshareUser, "unshareUser") ?? defaults.unshareUser,
		unshareIpc: normalizeOptionalBoolean(value.unshareIpc, "unshareIpc") ?? defaults.unshareIpc,
		unsharePid: normalizeOptionalBoolean(value.unsharePid, "unsharePid") ?? defaults.unsharePid,
		unshareUts: normalizeOptionalBoolean(value.unshareUts, "unshareUts") ?? defaults.unshareUts,
		unshareCgroup: normalizeOptionalBoolean(value.unshareCgroup, "unshareCgroup") ?? defaults.unshareCgroup,
	};

	if (normalized.defaultSandboxRw) {
		normalized.allowSandboxRw = true;
	}

	return {
		...normalized,
		...hydrateLegacyPrivilegeCompatibility(normalized),
	};
}

function normalizeLegacyBpkgBoxPrivilegeConfig(
	value: { allowedPrivilegeLevels?: unknown; defaultPrivilegeLevel?: unknown; sandboxPolicyExtensions?: unknown },
	fallbackDefaultPrivilegeLevel: BpkgPrivilegeLevel = DEFAULT_BPKG_PRIVILEGE_LEVEL,
): BpkgBoxPrivilegeConfig {
	const defaultPrivilegeLevel = normalizeOptionalBpkgPrivilegeLevel(
		value.defaultPrivilegeLevel,
		"defaultPrivilegeLevel",
	) ?? fallbackDefaultPrivilegeLevel;
	const allowedPrivilegeLevels = normalizeBpkgAllowedPrivilegeLevels(
		value.allowedPrivilegeLevels,
		"allowedPrivilegeLevels",
		defaultPrivilegeLevel,
	);
	const sandboxPolicyExtensions = normalizeBpkgSandboxPolicyExtensions(value.sandboxPolicyExtensions);
	return normalizeFlatBpkgBoxPrivilegeConfig({
		allowHostPrivileged: allowedPrivilegeLevels.includes("host-privileged"),
		allowSandboxRw: allowedPrivilegeLevels.includes("sandbox-rw"),
		defaultSandboxRw: defaultPrivilegeLevel === "sandbox-rw",
		hostDev: sandboxPolicyExtensions.devMode === "host",
		hostProc: sandboxPolicyExtensions.procMode !== "sandbox",
		hostSys: sandboxPolicyExtensions.sysMode !== "off",
		shareNetwork: sandboxPolicyExtensions.shareNetwork,
	});
}

function mergeBpkgBoxPrivilegeConfig(
	base: BpkgBoxPrivilegeConfig,
	overrides: BpkgBoxPrivilegeConfigInput,
): BpkgBoxPrivilegeConfig {
	let next = extractBpkgBoxPrivilegeConfig(base);

	if (hasLegacyBpkgBoxPolicyInput(overrides)) {
		const legacyBase = hydrateLegacyPrivilegeCompatibility(extractFlatBpkgBoxPrivilegeConfig(next));
		next = normalizeLegacyBpkgBoxPrivilegeConfig({
			allowedPrivilegeLevels: overrides.allowedPrivilegeLevels ?? legacyBase.allowedPrivilegeLevels,
			defaultPrivilegeLevel: overrides.defaultPrivilegeLevel ?? legacyBase.defaultPrivilegeLevel,
			sandboxPolicyExtensions: overrides.sandboxPolicyExtensions ?? legacyBase.sandboxPolicyExtensions,
		});
	}

	if (hasFlatBpkgBoxPolicyInput(overrides)) {
		next = normalizeFlatBpkgBoxPrivilegeConfig({
			...extractFlatBpkgBoxPrivilegeConfig(next),
			...overrides,
		});
	}

	return next;
}

function normalizePersistedBpkgBoxPrivilegeConfig(box: Partial<BpkgBoxRecord>): BpkgBoxPrivilegeConfig {
	try {
		return normalizeBpkgBoxPrivilegeConfig(box, DEFAULT_BPKG_PRIVILEGE_LEVEL);
	} catch {
		return createDefaultBpkgBoxPrivilegeConfig();
	}
}

function extractBpkgBoxPrivilegeConfig(
	box: Pick<BpkgBoxPrivilegeConfig, BpkgBoxPolicyBooleanKey>,
): BpkgBoxPrivilegeConfig {
	return normalizeFlatBpkgBoxPrivilegeConfig(extractFlatBpkgBoxPrivilegeConfig(box));
}

function applyBpkgBoxPrivilegeConfig<T extends Omit<BpkgBoxRecord, keyof BpkgBoxPrivilegeConfig>>(
	box: T,
	privilegeConfig: BpkgBoxPrivilegeConfig,
): BpkgBoxRecord {
	const flatPolicy = extractFlatBpkgBoxPrivilegeConfig(privilegeConfig);
	return {
		...box,
		...flatPolicy,
		...hydrateLegacyPrivilegeCompatibility(flatPolicy),
	};
}

function toPersistedBpkgBoxRecord(box: BpkgBoxRecord): PersistedBpkgBoxRecord {
	const { allowedPrivilegeLevels, defaultPrivilegeLevel, sandboxPolicyExtensions, ...persisted } = box;
	return persisted;
}

function buildBwrapSandboxArgs(policy: Pick<BpkgBoxRecord, "hostDev" | "hostProc" | "hostSys">): string[] {
	const args: string[] = [];

	if (policy.hostDev) {
		args.push("--dev-bind", "/dev", "/dev");
	} else {
		args.push("--dev", "/dev");
	}

	if (policy.hostProc) {
		args.push("--ro-bind", "/proc", "/proc");
	} else {
		args.push("--proc", "/proc");
	}

	if (policy.hostSys) {
		args.push("--ro-bind", "/sys", "/sys");
	}

	return args;
}

function buildBwrapNamespaceArgs(
	policy: Pick<BpkgBoxRecord, "shareNetwork" | "unshareUser" | "unshareIpc" | "unsharePid" | "unshareUts" | "unshareCgroup">,
): string[] {
	const args: string[] = [];

	if (policy.unshareUser) {
		args.push("--unshare-user");
	}

	if (policy.unshareIpc) {
		args.push("--unshare-ipc");
	}

	if (policy.unsharePid) {
		args.push("--unshare-pid");
	}

	if (!policy.shareNetwork) {
		args.push("--unshare-net");
	}

	if (policy.unshareUts) {
		args.push("--unshare-uts");
	}

	if (policy.unshareCgroup) {
		args.push("--unshare-cgroup");
	}

	return args;
}

function normalizeTerminalDimension(value: number | undefined, fallback: number, range: { min: number; max: number }): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}

	const rounded = Math.round(value);
	if (rounded < range.min) {
		return range.min;
	}

	if (rounded > range.max) {
		return range.max;
	}

	return rounded;
}

function resolveAvailableManifestDependencyCommand(dependencyId: string): string | null {
	const dependency = $manifest.refreshDependency(dependencyId);
	if (!dependency.available) {
		return null;
	}

	return dependency.resolvedPath ?? dependency.resolvedBinary ?? dependency.binary;
}

export class BpkgKit extends Kit {
	private readonly dataRoot: string;
	private readonly registryPath: string;
	private registry: RuntimeBpkgRegistry = {
		boxes: [],
		defaultBoxId: null,
	};
	private hostInfo: BpkgHostInfo = {
		archCompatible: false,
		bwrapExecutable: null,
		distro: {
			id: null,
			idLike: [],
			name: null,
			prettyName: null,
			versionId: null,
		},
		isRoot: false,
		nspawnExecutable: null,
		pacstrapExecutable: null,
		platform: process.platform,
		sudoExecutable: null,
	};

	constructor(options: { dataRoot?: string } = {}) {
		super({
			id: BPKG_KIT_ID,
			name: "BPkg Kit",
			description: "Manage Arch bubblewrap/pacstrap boxes and supported package bindings.",
		});
		this.dataRoot = path.resolve(options.dataRoot ?? resolveWritableRuntimePath("data"));
		this.registryPath = path.join(this.dataRoot, "bpkg", "registry.json");
	}

	protected override async onStart(_context: KitLifecycleContext): Promise<void> {
		await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
		this.registry = await this.loadRegistry();
		this.hostInfo = await this.detectHostInfo();
		this.registry.boxes = await Promise.all(this.registry.boxes.map(async (box) => await this.refreshBoxRecord(box)));
		if (this.registry.defaultBoxId && !this.registry.boxes.some((box) => box.id === this.registry.defaultBoxId)) {
			this.registry.defaultBoxId = null;
		}
		await this.persistRegistry();
	}

	async getHostInfo(): Promise<BpkgHostInfo> {
		return structuredClone(this.hostInfo);
	}

	listBoxes(): BpkgBoxRecord[] {
		return this.registry.boxes
			.map(cloneBox)
			.sort((left, right) => left.id.localeCompare(right.id));
	}

	getDefaultBoxId(): string | null {
		return this.registry.defaultBoxId;
	}

	getDefaultBox(): BpkgBoxRecord | null {
		if (!this.registry.defaultBoxId) {
			return null;
		}

		return this.getBox(this.registry.defaultBoxId);
	}

	getBox(boxId: string): BpkgBoxRecord | null {
		const normalizedBoxId = slugifyBoxId(boxId);
		const box = this.registry.boxes.find((entry) => entry.id === normalizedBoxId);
		return box ? cloneBox(box) : null;
	}

	getBoxPrivilege(boxId: string): BpkgBoxPrivilegeConfig | null {
		const box = this.getBox(boxId);
		return box ? extractBpkgBoxPrivilegeConfig(box) : null;
	}

	listSupportedPackages(): BpkgSupportedPackageSummary[] {
		return listRegisteredBpkgPackages();
	}

	inspect(): BpkgListResult {
		return {
			boxes: this.listBoxes(),
			defaultBoxId: this.getDefaultBoxId(),
			hostInfo: structuredClone(this.hostInfo),
		};
	}

	async createBox(options: CreateBoxOptions): Promise<BpkgBoxRecord> {
		this.assertArchCompatible();

		const candidateId = options.id ?? options.name;
		if (!candidateId) {
			throw new Error("bpkg box creation requires an id or name.");
		}

		const boxId = slugifyBoxId(candidateId);
		const existingBox = this.registry.boxes.find((entry) => entry.id === boxId);
		const now = Date.now();
		const existingPrivilegeConfig = existingBox
			? extractBpkgBoxPrivilegeConfig(existingBox)
			: createDefaultBpkgBoxPrivilegeConfig();
		const nextPrivilegeConfig = mergeBpkgBoxPrivilegeConfig(existingPrivilegeConfig, options);
		const workingBox: BpkgBoxRecord = existingBox
			? applyBpkgBoxPrivilegeConfig({
				...existingBox,
				...(options.description ? { description: options.description } : {}),
				name: options.name?.trim() || existingBox.name,
				packages: [...existingBox.packages],
				rootPath: this.resolveBoxRootPath(boxId),
				status: "building",
				updatedAt: now,
				lastError: undefined,
			}, nextPrivilegeConfig)
			: applyBpkgBoxPrivilegeConfig({
				createdAt: now,
				...(options.description ? { description: options.description } : {}),
				id: boxId,
				name: options.name?.trim() || boxId,
				packages: [],
				rootPath: this.resolveBoxRootPath(boxId),
				status: "building",
				updatedAt: now,
			}, nextPrivilegeConfig);

		this.upsertBox(workingBox);
		await this.persistRegistry();

		try {
			await this.bootstrapBoxRoot(workingBox);
			workingBox.status = "ready";
			workingBox.updatedAt = Date.now();
			delete workingBox.lastError;
			this.upsertBox(workingBox);
			if (!this.registry.defaultBoxId) {
				this.registry.defaultBoxId = workingBox.id;
			}
			await this.persistRegistry();

			const requestedPackageIds = normalizeStringArray(options.packages ?? []);
			if (requestedPackageIds.length > 0) {
				await this.installSupportedPackages(requestedPackageIds, workingBox.id);
			}

			return this.requireBox(workingBox.id);
		} catch (error) {
			workingBox.status = "error";
			workingBox.updatedAt = Date.now();
			workingBox.lastError = formatPersistedBoxError(error);
			this.upsertBox(workingBox);
			await this.persistRegistry();
			throw error;
		}
	}

	async selectDefaultBox(boxId: string): Promise<BpkgBoxRecord> {
		const box = this.requireBox(boxId);
		this.registry.defaultBoxId = box.id;
		await this.persistRegistry();
		return box;
	}

	async setBoxPrivilege(boxId: string, options: SetBoxPrivilegeOptions): Promise<BpkgBoxRecord> {
		const box = this.requireBox(boxId);
		const privilegeConfig = mergeBpkgBoxPrivilegeConfig(extractBpkgBoxPrivilegeConfig(box), options);
		const updatedBox = applyBpkgBoxPrivilegeConfig({
			...box,
			updatedAt: Date.now(),
		}, privilegeConfig);
		this.upsertBox(updatedBox);
		await this.persistRegistry();
		return updatedBox;
	}

	async deleteBox(boxId: string): Promise<{ defaultBoxId: string | null; target: string }> {
		const box = this.requireBox(boxId);
		await this.cleanupMountedBoxPaths(box);
		await this.removeBoxDataPath(box.id, box.rootPath);
		this.registry.boxes = this.registry.boxes.filter((entry) => entry.id !== box.id);
		if (this.registry.defaultBoxId === box.id) {
			this.registry.defaultBoxId = this.registry.boxes[0]?.id ?? null;
		}
		await this.persistRegistry();
		return {
			defaultBoxId: this.registry.defaultBoxId,
			target: box.id,
		};
	}

	async installSupportedPackages(packageIds: readonly string[], boxId?: string): Promise<BpkgInstallResult> {
		const normalizedPackageIds = normalizeStringArray(packageIds);
		if (normalizedPackageIds.length === 0) {
			throw new Error("bpkg installation requires at least one supported package id.");
		}

		const targetBox = await this.ensureBoxReady(this.resolveTargetBoxId(boxId));
		const packageDefinitions = normalizedPackageIds.map((packageId) => {
			const packageDefinition = getRegisteredBpkgPackage(packageId);
			if (!packageDefinition) {
				throw new Error(`Unsupported bpkg package '${packageId}'.`);
			}

			return packageDefinition;
		});

		const pendingDefinitions = packageDefinitions.filter(
			(packageDefinition) => !targetBox.packages.includes(packageDefinition.id),
		);
		if (pendingDefinitions.length === 0) {
			return {
				box: targetBox,
				commandResults: [],
				packageIds: [],
				pacmanPackages: [],
				paruPackages: [],
			};
		}

		const pacmanPackages = normalizeStringArray(
			pendingDefinitions.flatMap((packageDefinition) => packageDefinition.dependency.pacman ?? []),
		);
		const paruPackages = normalizeStringArray(
			pendingDefinitions.flatMap((packageDefinition) => packageDefinition.dependency.paru ?? []),
		);

		if (paruPackages.length > 0) {
			throw new BpkgUnsupportedError(
				"bpkg AUR/paru dependency installation is not implemented yet inside boxes.",
			);
		}

		const commandResults: BpkgCommandResult[] = [];
		if (pacmanPackages.length > 0) {
			commandResults.push(await this.installPacmanPackagesIntoBox(targetBox, pacmanPackages));
		}

		const updatedBox = {
			...targetBox,
			packages: normalizeStringArray([...targetBox.packages, ...pendingDefinitions.map((packageDefinition) => packageDefinition.id)]),
			updatedAt: Date.now(),
		};
		this.upsertBox(updatedBox);
		await this.persistRegistry();

		return {
			box: updatedBox,
			commandResults,
			packageIds: pendingDefinitions.map((packageDefinition) => packageDefinition.id),
			pacmanPackages,
			paruPackages,
		};
	}

	async executeBoxCommand(
		boxId: string,
		execution: ExecuteBoxCommandOptions,
	): Promise<BpkgCommandResult> {
		const preparedExecution = await this.prepareBoxCommandExecution(boxId, execution);
		return await this.runPreparedBoxCommand(preparedExecution);
	}

	async openBoxTerminal(boxId: string, options: OpenBoxTerminalOptions = {}): Promise<BpkgTerminalSession> {
		const cols = normalizeTerminalDimension(options.cols, 120, { min: 40, max: 240 });
		const rows = normalizeTerminalDimension(options.rows, 28, { min: 12, max: 120 });
		const scriptExecutable = await this.resolveScriptExecutable();
		const preparedExecution = await this.prepareBoxCommandExecution(boxId, {
			argv: ["/bin/bash", "-i"],
			env: {
				TERM: "xterm-256color",
				COLUMNS: String(cols),
				LINES: String(rows),
			},
			privilegeLevel: options.privilegeLevel,
			writableRoot: true,
		});

		const child = Bun.spawn({
			cmd: [scriptExecutable, "-qfc", formatShellCommand(preparedExecution.argv), "/dev/null"],
			cwd: process.cwd(),
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				COLUMNS: String(cols),
				LINES: String(rows),
				TERM: "xterm-256color",
			},
		});

		const stdin = child.stdin;

		return {
			box: preparedExecution.box,
			child,
			cols,
			command: [scriptExecutable, "-qfc", formatShellCommand(preparedExecution.argv), "/dev/null"],
			commandString: formatCommand([scriptExecutable, "-qfc", formatShellCommand(preparedExecution.argv), "/dev/null"]),
			rows,
			write: async (data) => {
				const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
				stdin.write(bytes);
			},
			close: async () => {
				try {
					stdin.end();
				} catch {
					// Ignore terminal writer shutdown failures after process exit.
				}

				if (child.exitCode === null) {
					child.kill();
				}

				await child.exited.catch(() => undefined);
				await this.restoreBoxOwnershipAfterPrivilegedExecution(preparedExecution);
			},
		};
	}

	async executePackageBinding(
		packageId: string,
		bindingId: string,
		params: unknown,
		options: ExecutePackageBindingOptions = {},
	): Promise<BpkgBindingExecutionResult> {
		const packageDefinition = getRegisteredBpkgPackage(packageId);
		if (!packageDefinition) {
			throw new Error(`Unsupported bpkg package '${packageId}'.`);
		}

		const selectedBox = this.getDefaultBox();
		if (!selectedBox) {
			throw new Error(
				`No default bpkg box is selected. Create or select one with $.bpkg.create(...) or $.bpkg.select("${packageId}").`,
			);
		}
		const targetBox = await this.ensureBoxReady(selectedBox.id);

		if (!targetBox.packages.includes(packageId)) {
			throw new Error(
				`Package '${packageId}' is not installed in bpkg box '${targetBox.id}'. Run $.bpkg.install("${packageId}") first.`,
			);
		}

		const transformer = packageDefinition.transformers[bindingId];
		if (!transformer) {
			throw new Error(`Unsupported bpkg binding '${packageId}/${bindingId}'.`);
		}

		const bindingDefinition = getBpkgBindingDefinition(packageDefinition, bindingId);
		let normalizedParams = normalizeBpkgBindingParams(packageDefinition, bindingId, params);

		if (bindingDefinition.prepare) {
			const prepareResult = await bindingDefinition.prepare({
				bindingId,
				boxFileExists: async (filePath) => {
					const resolvedPath = this.resolveBoxFilePath(targetBox, filePath);
					return await fs.stat(resolvedPath).then(() => true).catch(() => false);
				},
				boxId: targetBox.id,
				packageId,
				packageName: packageDefinition.package,
				params: normalizedParams,
				readBoxFile: async (filePath) => {
					const resolvedPath = this.resolveBoxFilePath(targetBox, filePath);
					return await fs.readFile(resolvedPath, "utf8");
				},
				runtime: options.runtime ?? {
					getKit: () => null,
					ensureKit: async (_id, createKit) => await createKit(),
				},
				writeBoxFile: async (filePath, content) => {
					const resolvedPath = this.resolveBoxFilePath(targetBox, filePath);
					await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
					await fs.writeFile(resolvedPath, content);
				},
			});

			if (prepareResult && Object.keys(prepareResult).length > 0) {
				normalizedParams = normalizeBpkgBindingParams(packageDefinition, bindingId, {
					...normalizedParams,
					...prepareResult,
				});
			}
		}

		const transpiled = await transformer(normalizedParams, {
			bindingId,
			packageId,
			packageName: packageDefinition.package,
		});
		const preparedExecution = await this.prepareBoxCommandExecution(targetBox.id, {
			...transpiled,
			privilegeLevel: options.privilegeLevel ?? transpiled.privilegeLevel,
		});
		const result = await this.runPreparedBoxCommand(preparedExecution, {
			acceptedExitCodes: bindingDefinition.acceptedExitCodes,
			commandHandlers: options.commandHandlers,
		});
		const parsed = bindingDefinition.responseParser
			? await bindingDefinition.responseParser(result, {
				bindingId,
				boxId: preparedExecution.box.id,
				packageId,
				packageName: packageDefinition.package,
				params: normalizedParams,
				readFile: async (filePath) => {
					const fileResult = await this.executeBoxCommand(targetBox.id, {
						argv: ["cat", filePath],
						privilegeLevel: preparedExecution.privilegeLevel,
					});
					return fileResult.stdout;
				},
				transpiled,
			})
			: undefined;
		return {
			...result,
			bindingId,
			...(parsed !== undefined ? { parsed } : {}),
			packageId,
			transpiled,
		};
	}

	private resolveBoxFilePath(box: BpkgBoxRecord, filePath: string): string {
		const normalizedPath = normalizeString(filePath, "filePath");
		const normalizedAbsolutePath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
		const boxHomePath = this.resolveBoxHomePath(box.id);
		const basePath = normalizedAbsolutePath === "/root" || normalizedAbsolutePath.startsWith("/root/")
			? boxHomePath
			: box.rootPath;
		const relativePath = normalizedAbsolutePath === "/root"
			? ""
			: normalizedAbsolutePath.startsWith("/root/")
				? normalizedAbsolutePath.slice("/root/".length)
				: normalizedAbsolutePath.slice(1);
		const resolvedPath = path.resolve(basePath, relativePath);
		const relativeToBase = path.relative(basePath, resolvedPath);
		if (relativeToBase.startsWith("..") || path.isAbsolute(relativeToBase)) {
			throw new Error(`Box file path '${filePath}' escapes the target rootfs.`);
		}

		return resolvedPath;
	}

	private async loadRegistry(): Promise<RuntimeBpkgRegistry> {
		try {
			const payload = await fs.readFile(this.registryPath, "utf8");
			const parsed = JSON.parse(payload) as Partial<PersistedBpkgRegistry>;
			return {
				boxes: Array.isArray(parsed.boxes)
					? parsed.boxes.map((box) => {
						const privilegeConfig = normalizePersistedBpkgBoxPrivilegeConfig(box as Partial<BpkgBoxRecord>);
						return applyBpkgBoxPrivilegeConfig({
							...box,
							packages: Array.isArray(box.packages) ? normalizeStringArray(box.packages) : [],
							rootPath: typeof box.rootPath === "string" && box.rootPath.length > 0
								? box.rootPath
								: this.resolveBoxRootPath(box.id),
						}, privilegeConfig);
					})
					: [],
				defaultBoxId: typeof parsed.defaultBoxId === "string" ? parsed.defaultBoxId : null,
			};
		} catch {
			return {
				boxes: [],
				defaultBoxId: null,
			};
		}
	}

	private async persistRegistry(): Promise<void> {
		await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
		const persistedRegistry: PersistedBpkgRegistry = {
			boxes: this.registry.boxes.map((box) => toPersistedBpkgBoxRecord(box)),
			defaultBoxId: this.registry.defaultBoxId,
		};
		await fs.writeFile(this.registryPath, JSON.stringify(persistedRegistry, null, 2), "utf8");
	}

	private upsertBox(box: BpkgBoxRecord): void {
		const index = this.registry.boxes.findIndex((entry) => entry.id === box.id);
		if (index >= 0) {
			this.registry.boxes[index] = cloneBox(box);
			return;
		}

		this.registry.boxes.push(cloneBox(box));
	}

	private requireBox(boxId: string): BpkgBoxRecord {
		const box = this.getBox(boxId);
		if (!box) {
			throw new Error(`Unknown bpkg box '${boxId}'.`);
		}

		return box;
	}

	private async refreshBoxRecord(box: BpkgBoxRecord): Promise<BpkgBoxRecord> {
		const shellPath = path.join(box.rootPath, "usr", "bin", "bash");
		const hasShell = await fs.stat(shellPath).then(() => true).catch(() => false);
		const privilegeConfig = normalizePersistedBpkgBoxPrivilegeConfig(box);
		return applyBpkgBoxPrivilegeConfig({
			...box,
			packages: normalizeStringArray(box.packages),
			status: hasShell ? (box.status === "error" ? "ready" : box.status === "building" ? "ready" : box.status) : "missing",
		}, privilegeConfig);
	}

	private resolveBoxRootPath(boxId: string): string {
		return path.resolve(this.dataRoot, `container-${boxId}`);
	}

	private resolveBoxHomePath(boxId: string): string {
		return path.resolve(this.dataRoot, "bpkg", "boxes", boxId, "home");
	}

	private resolveBoxDataPath(boxId: string): string {
		return path.resolve(this.dataRoot, "bpkg", "boxes", boxId);
	}

	private async prepareBoxCommandExecution(
		boxId: string,
		execution: ExecuteBoxCommandOptions,
	): Promise<BoxCommandExecution> {
		const targetBox = await this.ensureBoxReady(boxId);
		const privilegeLevel = this.resolveExecutionPrivilegeLevel(targetBox, execution);
		if (privilegeLevel !== "sandbox-ro") {
			await this.ensureBoxWritableOwnership(targetBox);
		}
		const homePath = this.resolveBoxHomePath(targetBox.id);
		await fs.mkdir(homePath, { recursive: true });
		const runner: HostRunner = privilegeLevel === "host-privileged" ? "nspawn" : "bwrap";
		const baseCommand = runner === "nspawn"
			? this.buildNspawnBoxCommand(targetBox, execution, homePath)
			: this.buildBwrapBoxCommand(targetBox, execution, homePath, privilegeLevel === "sandbox-rw");

		return {
			box: targetBox,
			privilegeLevel,
			runner,
			argv: baseCommand,
		};
	}

	private buildBoxPayloadCommand(execution: ExecuteBoxCommandOptions): string[] {
		return execution.argv && execution.argv.length > 0
			? [...execution.argv]
			: ["/bin/bash", "-lc", normalizeString(execution.command, "command")];
	}

	private buildBwrapBoxCommand(
		targetBox: BpkgBoxRecord,
		execution: ExecuteBoxCommandOptions,
		homePath: string,
		writableRoot: boolean,
	): string[] {
		const bwrapExecutable = this.assertBwrapSupported();
		const envArgs = Object.entries(execution.env ?? {}).flatMap(([key, value]) => [
			"--setenv",
			key,
			value,
		]);
		const namespaceArgs = buildBwrapNamespaceArgs(targetBox);
		const userName = targetBox.unshareUser
			? "root"
			: normalizeOptionalString(process.env.USER, "USER") ?? "user";
		return [
			bwrapExecutable,
			writableRoot ? "--bind" : "--ro-bind",
			targetBox.rootPath,
			"/",
			...buildBwrapSandboxArgs(targetBox),
			"--tmpfs",
			"/tmp",
			"--bind",
			homePath,
			"/root",
			"--ro-bind",
			"/etc/resolv.conf",
			"/etc/resolv.conf",
			"--setenv",
			"HOME",
			"/root",
			"--setenv",
			"USER",
			userName,
			...(targetBox.unshareUser ? ["--uid", "0", "--gid", "0"] : []),
			...(execution.cwd ? ["--chdir", execution.cwd] : ["--chdir", "/root"]),
			...envArgs,
			...namespaceArgs,
			...(targetBox.unshareUts ? ["--hostname", `${targetBox.id}-box`] : []),
			...this.buildBoxPayloadCommand(execution),
		];
	}

	private buildNspawnBoxCommand(
		targetBox: BpkgBoxRecord,
		execution: ExecuteBoxCommandOptions,
		homePath: string,
	): string[] {
		const nspawnExecutable = this.assertNspawnSupported();
		const envArgs = Object.entries(execution.env ?? {}).flatMap(([key, value]) => ["--setenv", `${key}=${value}`]);
		const capabilityArgs = HOST_PRIVILEGED_CAPABILITIES.map((capability) => `--capability=${capability}`);
		return this.prefixWithSudoIfNeeded([
			nspawnExecutable,
			"--quiet",
			"--settings=no",
			"--register=no",
			"--as-pid2",
			"--pipe",
			`--directory=${targetBox.rootPath}`,
			`--hostname=${targetBox.id}-box`,
			"--private-users=no",
			"--resolv-conf=copy-host",
			"--user=root",
			`--bind=${homePath}:/root`,
			"--bind=/sys:/sys",
			...capabilityArgs,
			"--setenv",
			"HOME=/root",
			"--setenv",
			"USER=root",
			...(execution.cwd ? [`--chdir=${execution.cwd}`] : ["--chdir=/root"]),
			...envArgs,
			...this.buildBoxPayloadCommand(execution),
		]);
	}

	private resolveExecutionPrivilegeLevel(
		box: BpkgBoxRecord,
		execution: ExecuteBoxCommandOptions,
	): BpkgPrivilegeLevel {
		const requestedPrivilegeLevel = execution.privilegeLevel
			?? (execution.writableRoot ? "sandbox-rw" : box.defaultSandboxRw ? "sandbox-rw" : "sandbox-ro");
		const allowedLevels = listAllowedBpkgPrivilegeLevels(box);
		const isAllowed = requestedPrivilegeLevel === "sandbox-ro"
			|| (requestedPrivilegeLevel === "sandbox-rw" && box.allowSandboxRw)
			|| (requestedPrivilegeLevel === "host-privileged" && box.allowHostPrivileged);
		if (!isAllowed) {
			throw new BpkgUnsupportedError(
				[
					`bpkg box '${box.id}' does not allow privilege level '${requestedPrivilegeLevel}'.`,
					`Allowed levels: ${allowedLevels.join(", ")}.`,
				].join(" "),
			);
		}

		return requestedPrivilegeLevel;
	}

	private resolveTargetBoxId(boxId: string | undefined): string {
		if (boxId) {
			return slugifyBoxId(boxId);
		}

		if (!this.registry.defaultBoxId) {
			throw new Error("No default bpkg box is selected.");
		}

		return this.registry.defaultBoxId;
	}

	private async ensureBoxReady(boxId: string): Promise<BpkgBoxRecord> {
		const existingBox = this.requireBox(boxId);
		const refreshedBox = await this.refreshBoxRecord(existingBox);
		this.upsertBox(refreshedBox);
		if (refreshedBox.status === "ready") {
			await this.normalizePacmanConfig(refreshedBox.rootPath);
			await this.persistRegistry();
			return refreshedBox;
		}

		return await this.createBox({
			description: refreshedBox.description,
			id: refreshedBox.id,
			name: refreshedBox.name,
		});
	}

	private async bootstrapBoxRoot(box: BpkgBoxRecord): Promise<void> {
		const shellPath = path.join(box.rootPath, "usr", "bin", "bash");
		const hasShell = await fs.stat(shellPath).then(() => true).catch(() => false);
		if (!hasShell) {
			await fs.mkdir(path.dirname(box.rootPath), { recursive: true });
			await fs.mkdir(box.rootPath, { recursive: true });
			const pacstrapExecutable = this.assertPacstrapSupported();
			const command = this.prefixWithSudoIfNeeded([
				pacstrapExecutable,
				"-K",
				"-c",
				box.rootPath,
				"base",
				"bash",
				"coreutils",
				"pacman",
				"--nodeps",
			]);
			await this.runCommand(box.id, command, { runner: "pacstrap" });
			await this.normalizePacmanConfig(box.rootPath);
		}

		await this.ensureBoxWritableOwnership(box);
		await this.normalizePacmanConfig(box.rootPath);
		await fs.mkdir(this.resolveBoxHomePath(box.id), { recursive: true });
	}

	private async normalizePacmanConfig(rootPath: string): Promise<void> {
		const pacmanConfigPath = path.join(rootPath, "etc", "pacman.conf");
		try {
			const configText = await fs.readFile(pacmanConfigPath, "utf8");
			let nextText = configText.replace(/^CheckSpace$/gmu, "#CheckSpace");
			nextText = nextText.replace(/^DownloadUser\s*=\s*.+$/gmu, "DownloadUser = root");
			nextText = nextText.replace(/^#DisableSandboxFilesystem$/gmu, "DisableSandboxFilesystem");
			nextText = nextText.replace(/^#DisableSandboxSyscalls$/gmu, "DisableSandboxSyscalls");

			if (!/^DownloadUser\s*=\s*root$/mu.test(nextText)) {
				nextText = nextText.replace(
					/^ParallelDownloads\s*=.*$/mu,
					(match) => `${match}\nDownloadUser = root`,
				);
			}

			if (nextText !== configText) {
				await fs.writeFile(pacmanConfigPath, nextText, "utf8");
			}
		} catch {
			// Best effort.
		}
	}

	private async installPacmanPackagesIntoBox(
		box: BpkgBoxRecord,
		packages: readonly string[],
	): Promise<BpkgCommandResult> {
		const pacstrapExecutable = this.assertPacstrapSupported();
		const command = this.prefixWithSudoIfNeeded([
			pacstrapExecutable,
			"-K",
			"-c",
			box.rootPath,
			...packages,
		]);
		const result = await this.runCommand(box.id, command, { runner: "pacstrap" });
		await this.ensureBoxWritableOwnership(box);
		return result;
	}

	private async detectHostInfo(): Promise<BpkgHostInfo> {
		const distro = process.platform === "linux"
			? await readLinuxDistroInfo()
			: {
				id: null,
				idLike: [],
				name: null,
				prettyName: null,
				versionId: null,
			};

		return {
			archCompatible: process.platform === "linux" && isArchCompatibleDistro(distro),
			bwrapExecutable: resolveAvailableManifestDependencyCommand(BWRAP_DEPENDENCY_ID),
			distro,
			isRoot: typeof process.getuid === "function" ? process.getuid() === 0 : false,
			nspawnExecutable: resolveAvailableManifestDependencyCommand(SYSTEMD_NSPAWN_DEPENDENCY_ID),
			pacstrapExecutable: resolveAvailableManifestDependencyCommand(PACSTRAP_DEPENDENCY_ID),
			platform: process.platform,
			sudoExecutable: resolveAvailableManifestDependencyCommand(SUDO_DEPENDENCY_ID),
		};
	}

	private assertArchCompatible(): void {
		if (this.hostInfo.archCompatible) {
			return;
		}

		const detectedDistro = this.hostInfo.distro.id ?? this.hostInfo.distro.prettyName ?? this.hostInfo.platform;
		throw new BpkgUnsupportedError(`bpkg boxes are only supported on Arch Linux hosts; detected ${detectedDistro}.`);
	}

	private assertBwrapSupported(): string {
		this.assertArchCompatible();
		if (!this.hostInfo.bwrapExecutable) {
			throw new BpkgUnsupportedError(
				"bubblewrap executable was not found on this host. Update manifest.dependencies.bwrap.binary or install bubblewrap in PATH.",
			);
		}

		return this.hostInfo.bwrapExecutable;
	}

	private assertPacstrapSupported(): string {
		this.assertArchCompatible();
		if (!this.hostInfo.pacstrapExecutable) {
			throw new BpkgUnsupportedError(
				"pacstrap executable was not found on this host. Update manifest.dependencies.pacstrap.binary or install arch-install-scripts in PATH.",
			);
		}

		return this.hostInfo.pacstrapExecutable;
	}

	private assertNspawnSupported(): string {
		this.assertArchCompatible();
		if (!this.hostInfo.nspawnExecutable) {
			throw new BpkgUnsupportedError(
				"systemd-nspawn is required for host-privileged bpkg execution but is not available. Update manifest.dependencies.systemd-nspawn.binary or install systemd-container/systemd in PATH.",
			);
		}

		return this.hostInfo.nspawnExecutable;
	}

	private assertSudoSupported(): string {
		if (!this.hostInfo.sudoExecutable) {
			throw new BpkgUnsupportedError(
				"sudo is required for this bpkg operation but is not available. Update manifest.dependencies.sudo.binary or install sudo in PATH.",
			);
		}

		return this.hostInfo.sudoExecutable;
	}

	private prefixWithSudoIfNeeded(command: readonly string[]): string[] {
		if (this.hostInfo.isRoot) {
			return [...command];
		}

		return [this.assertSudoSupported(), "-n", ...command];
	}

	private async ensureBoxWritableOwnership(box: BpkgBoxRecord): Promise<void> {
		if (this.hostInfo.isRoot) {
			return;
		}

		const uid = typeof process.getuid === "function" ? process.getuid() : null;
		const gid = typeof process.getgid === "function" ? process.getgid() : null;
		if (uid === null || gid === null) {
			return;
		}

		await this.cleanupMountedBoxPaths(box);

		const command = this.prefixWithSudoIfNeeded([
			"/usr/bin/chown",
			"-R",
			`${uid}:${gid}`,
			box.rootPath,
		]);
		await this.runCommand(box.id, command, { runner: "pacstrap" });
	}

	private async cleanupMountedBoxPaths(box: Pick<BpkgBoxRecord, "id" | "rootPath">): Promise<void> {
		const mountInfo = await fs.readFile("/proc/self/mountinfo", "utf8").catch(() => "");
		if (!mountInfo) {
			return;
		}

		const mountedPaths = listMountedPathsWithin(mountInfo, box.rootPath);
		for (const mountedPath of mountedPaths) {
			const command = this.prefixWithSudoIfNeeded([
				"/usr/bin/umount",
				"-l",
				mountedPath,
			]);
			const result = await this.runCommand(box.id, command, {
				allowFailure: true,
				runner: "pacstrap",
			});
			if (result.exitCode !== 0) {
				const combinedOutput = `${result.stderr}\n${result.stdout}`;
				if (!/not mounted|no mount point specified|must be superuser|special device .* does not exist/iu.test(combinedOutput)) {
					throw new BpkgCommandError(result);
				}
			}
		}
	}

	private async removeBoxDataPath(boxId: string, rootPath: string): Promise<void> {
		const pathsToRemove = [this.resolveBoxDataPath(boxId), rootPath]
			.filter((entry, index, values) => values.indexOf(entry) === index);
		for (const targetPath of pathsToRemove) {
			const exists = await fs.stat(targetPath).then(() => true).catch(() => false);
			if (!exists) {
				continue;
			}

			const command = this.prefixWithSudoIfNeeded([
				"/usr/bin/rm",
				"-rf",
				"--one-file-system",
				targetPath,
			]);
			const result = await this.runCommand(boxId, command, {
				allowFailure: true,
				runner: "pacstrap",
			});
			const stillExists = await fs.stat(targetPath).then(() => true).catch(() => false);
			if (result.exitCode !== 0 || stillExists) {
				throw new BpkgCommandError({
					...result,
					stderr: stillExists && result.stderr.length === 0
						? `Failed to remove ${targetPath}.`
						: result.stderr,
				});
			}
		}
	}

	private async resolveScriptExecutable(): Promise<string> {
		const child = Bun.spawn({
			cmd: ["/usr/bin/env", "sh", "-lc", "command -v script"],
			cwd: process.cwd(),
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});

		const [exitCode, stdout] = await Promise.all([
			child.exited,
			readOutput(child.stdout),
		]);

		if (exitCode !== 0 || !stdout) {
			throw new BpkgUnsupportedError(
				"The host `script` executable is required for interactive box terminals but was not found in PATH.",
			);
		}

		return stdout.split(/\r?\n/u)[0]?.trim() || stdout.trim();
	}

	private async runCommand(
		boxId: string,
		command: readonly string[],
		options: {
			acceptedExitCodes?: readonly number[];
			allowFailure?: boolean;
			commandHandlers?: BpkgCommandStreamHandlers;
			runner: HostRunner;
		},
	): Promise<BpkgCommandResult> {
		const child = Bun.spawn({
			cmd: [...command],
			cwd: process.cwd(),
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});

		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			readOutputWithHandler(child.stdout, options.commandHandlers?.onStdoutChunk, "stdout"),
			readOutputWithHandler(child.stderr, options.commandHandlers?.onStderrChunk, "stderr"),
		]);

		const result: BpkgCommandResult = {
			boxId,
			command: [...command],
			commandString: formatCommand(command),
			exitCode,
			stderr,
			stdout,
		};

		if (
			exitCode !== 0
			&& !options.allowFailure
			&& !(options.acceptedExitCodes?.includes(exitCode) ?? false)
		) {
			throw new BpkgCommandError(result);
		}

		return result;
	}

	private async runPreparedBoxCommand(
		preparedExecution: BoxCommandExecution,
		options: {
			acceptedExitCodes?: readonly number[];
			allowFailure?: boolean;
			commandHandlers?: BpkgCommandStreamHandlers;
		} = {},
	): Promise<BpkgCommandResult> {
		let caughtError: unknown;
		try {
			return await this.runCommand(preparedExecution.box.id, preparedExecution.argv, {
				acceptedExitCodes: options.acceptedExitCodes,
				allowFailure: options.allowFailure,
				commandHandlers: options.commandHandlers,
				runner: preparedExecution.runner,
			});
		} catch (error) {
			caughtError = error;
			throw error;
		} finally {
			try {
				await this.restoreBoxOwnershipAfterPrivilegedExecution(preparedExecution);
			} catch (ownershipError) {
				if (caughtError === undefined) {
					throw ownershipError;
				}
			}
		}
	}

	private async restoreBoxOwnershipAfterPrivilegedExecution(preparedExecution: Pick<BoxCommandExecution, "box" | "privilegeLevel">): Promise<void> {
		if (preparedExecution.privilegeLevel !== "host-privileged") {
			return;
		}

		await this.ensureBoxWritableOwnership(preparedExecution.box);
	}
}