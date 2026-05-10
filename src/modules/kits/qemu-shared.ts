import path from "node:path";

import {
	QemuKit,
	type QemuCommandPreview,
	type QemuDiskInterface,
	type QemuKitEnvironmentReport,
	type QemuRouterNetworkConfig,
	type QemuVmPreset,
	type QemuVmRole,
} from "../../kits";
import {
	createTableEntity,
	createTextEntity,
	type OutputEntity,
} from "../../primitives";
import { InvalidParamsError } from "../errors";
import { defineNotebookTypeOverlay, type ModuleExecutionContext } from "../module";

type EnsureQemuKitContext = Pick<ModuleExecutionContext<unknown, object>, "getQemuKit" | "runtime">;

export const QEMU_NOTEBOOK_TYPE_OVERLAY = defineNotebookTypeOverlay("src/modules/kits/qemu.h.ts");

export const QEMU_DISK_INTERFACE_VALUES: readonly QemuDiskInterface[] = ["virtio", "ide", "scsi"];
export const QEMU_VM_ROLE_VALUES: readonly QemuVmRole[] = ["router"];

function createKeyValueTable(
	title: string,
	rows: Array<{ property: string; value: string }>,
): OutputEntity {
	return createTableEntity(
		[
			{ key: "property", header: "property", maxWidth: 28 },
			{ key: "value", header: "value", maxWidth: 92 },
		],
		rows,
		{ title },
	);
}

function formatOptionalBoolean(value: boolean | undefined): string {
	if (value === undefined) {
		return "<default>";
	}

	return value ? "yes" : "no";
}

function formatOptionalNumber(value: number | undefined, suffix = ""): string {
	if (value === undefined) {
		return "<default>";
	}

	return `${value}${suffix}`;
}

function formatOptionalString(value: string | undefined): string {
	return value && value.trim().length > 0 ? value : "<none>";
}

function renderShellCommand(command: readonly string[]): string {
	return command
		.map((argument) => (/^[A-Za-z0-9_./:=+-]+$/u.test(argument) ? argument : JSON.stringify(argument)))
		.join(" ");
}

export async function ensureQemuKit(
	context: EnsureQemuKitContext,
	reason = "module:kits/qemu",
): Promise<QemuKit> {
	const existingKit = context.getQemuKit();
	if (existingKit) {
		return existingKit;
	}

	return await context.runtime.attachKit(new QemuKit(), { reason });
}

export function parseOptionalString(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value !== "string") {
		throw new InvalidParamsError(`${fieldName} must be a string.`);
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value === "string") {
		switch (value.trim().toLowerCase()) {
			case "1":
			case "true":
			case "yes":
			case "on":
				return true;
			case "0":
			case "false":
			case "no":
			case "off":
				return false;
		}
	}

	throw new InvalidParamsError(`${fieldName} must be a boolean.`);
}

export function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(numericValue) || numericValue < 1) {
		throw new InvalidParamsError(`${fieldName} must be a positive integer.`);
	}

	return numericValue;
}

export function parseOptionalStringArray(value: unknown, fieldName: string): readonly string[] | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value === "string") {
		const values = value.split(",").map((entry) => entry.trim()).filter(Boolean);
		return values.length > 0 ? values : undefined;
	}

	if (Array.isArray(value)) {
		const values = value.map((entry, index) => {
			if (typeof entry !== "string") {
				throw new InvalidParamsError(`${fieldName}[${index}] must be a string.`);
			}

			return entry.trim();
		}).filter(Boolean);
		return values.length > 0 ? values : undefined;
	}

	throw new InvalidParamsError(`${fieldName} must be a string or string array.`);
}

export function parseOptionalQemuRole(value: unknown, fieldName: string): QemuVmRole | undefined {
	const normalized = parseOptionalString(value, fieldName);
	if (!normalized) {
		return undefined;
	}

	if ((QEMU_VM_ROLE_VALUES as readonly string[]).includes(normalized)) {
		return normalized as QemuVmRole;
	}

	throw new InvalidParamsError(`${fieldName} must be one of: ${QEMU_VM_ROLE_VALUES.join(", ")}.`);
}

export function parseOptionalDiskInterface(value: unknown, fieldName: string): QemuDiskInterface | undefined {
	const normalized = parseOptionalString(value, fieldName);
	if (!normalized) {
		return undefined;
	}

	if ((QEMU_DISK_INTERFACE_VALUES as readonly string[]).includes(normalized)) {
		return normalized as QemuDiskInterface;
	}

	throw new InvalidParamsError(`${fieldName} must be one of: ${QEMU_DISK_INTERFACE_VALUES.join(", ")}.`);
}

export function parseOptionalRouterNetworkConfig(
	value: unknown,
	fieldName: string,
): QemuRouterNetworkConfig | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const parsedValue = typeof value === "string" ? JSON.parse(value) : value;
	if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
		throw new InvalidParamsError(`${fieldName} must be a JSON object.`);
	}

	const record = parsedValue as Record<string, unknown>;
	const result: QemuRouterNetworkConfig = {
		hostname: parseOptionalString(record.hostname, `${fieldName}.hostname`),
		domain: parseOptionalString(record.domain, `${fieldName}.domain`),
		wanInterface: parseOptionalString(record.wanInterface, `${fieldName}.wanInterface`),
		lanInterface: parseOptionalString(record.lanInterface, `${fieldName}.lanInterface`),
		lanAddress: parseOptionalString(record.lanAddress, `${fieldName}.lanAddress`),
		lanPrefix: parseOptionalPositiveInteger(record.lanPrefix, `${fieldName}.lanPrefix`),
		dhcpStart: parseOptionalString(record.dhcpStart, `${fieldName}.dhcpStart`),
		dhcpEnd: parseOptionalString(record.dhcpEnd, `${fieldName}.dhcpEnd`),
		importDirectory: parseOptionalString(record.importDirectory, `${fieldName}.importDirectory`),
	};

	return Object.values(result).some((entry) => entry !== undefined) ? result : undefined;
}

export function findQemuPreset(
	kit: QemuKit,
	target: string | undefined,
): QemuVmPreset | null {
	const normalizedTarget = parseOptionalString(target, "target");
	if (!normalizedTarget) {
		return null;
	}

	const presets = kit.getPresets();
	const exactIdMatch = presets.find((preset) => preset.id === normalizedTarget);
	if (exactIdMatch) {
		return exactIdMatch;
	}

	const exactNameMatches = presets.filter((preset) => preset.name === normalizedTarget);
	if (exactNameMatches.length > 1) {
		throw new InvalidParamsError(
			`Multiple QEMU presets match '${normalizedTarget}'. Use target=<id> instead.`,
		);
	}

	return exactNameMatches[0] ?? null;
}

export function ensureUniqueQemuPresetName(
	kit: QemuKit,
	name: string,
	options: { excludeId?: string } = {},
): void {
	const conflictingPreset = kit.getPresets().find((preset) => (
		preset.name === name
		&& preset.id !== options.excludeId
	));

	if (conflictingPreset) {
		throw new InvalidParamsError(
			`QEMU preset name '${name}' is already used by '${conflictingPreset.id}'. Choose a different name or update that preset explicitly.`,
		);
	}
}

export function resolveQemuPreset(
	kit: QemuKit,
	target: string | undefined,
	options: { paramName?: string } = {},
): QemuVmPreset {
	const presets = kit.getPresets();
	const paramName = options.paramName ?? "target";
	const normalizedTarget = parseOptionalString(target, paramName);

	if (!normalizedTarget) {
		if (presets.length === 1) {
			return presets[0] as QemuVmPreset;
		}

		if (presets.length === 0) {
			throw new InvalidParamsError(
				"No saved QEMU presets found. Create or connect one first.",
			);
		}

		throw new InvalidParamsError(
			`Multiple QEMU presets are available. Pass ${paramName}=<id-or-name> or inspect them with $.kits.qemu.list().`,
		);
	}

	const exactIdMatch = presets.find((preset) => preset.id === normalizedTarget);
	if (exactIdMatch) {
		return exactIdMatch;
	}

	const exactNameMatches = presets.filter((preset) => preset.name === normalizedTarget);
	if (exactNameMatches.length === 1) {
		return exactNameMatches[0] as QemuVmPreset;
	}

	if (exactNameMatches.length > 1) {
		throw new InvalidParamsError(
			`Multiple QEMU presets match '${normalizedTarget}'. Use ${paramName}=<id> instead.`,
		);
	}

	throw new InvalidParamsError(
		`Unknown QEMU preset '${normalizedTarget}'. Use $.kits.qemu.list() to inspect saved presets.`,
	);
}

export function createQemuPresetListReport(kit: QemuKit): OutputEntity[] {
	const presets = kit.getPresets();
	const routerCount = presets.filter((preset) => preset.role === "router").length;
	const summaryLines = [
		`QEMU presets • ${presets.length} total`,
		`Router presets: ${routerCount}`,
		"Use $.kits.qemu.get(...), $.kits.qemu.preview(...), $.kits.qemu.save(...), and $.kits.qemu.delete(...) for notebook-safe preset workflows.",
	];

	if (presets.length === 0) {
		return [createTextEntity([...summaryLines, "", "No QEMU presets found."], {
			title: "QEMU presets",
			tone: "info",
		})];
	}

	return [
		createTextEntity(summaryLines, { title: "QEMU presets", tone: "muted" }),
		createTableEntity(
			[
				{ key: "name", header: "name", maxWidth: 28 },
				{ key: "role", header: "role", maxWidth: 10 },
				{ key: "presetId", header: "id", maxWidth: 18 },
				{ key: "disk", header: "disk", maxWidth: 24 },
				{ key: "cdrom", header: "cdrom", maxWidth: 24 },
				{ key: "memory", header: "memory", align: "right", maxWidth: 10 },
				{ key: "headless", header: "headless", align: "center", maxWidth: 10 },
			],
			presets.map((preset) => ({
				name: preset.name,
				role: preset.role ?? "vm",
				presetId: preset.id,
				disk: preset.diskImage ? path.basename(preset.diskImage) : "",
				cdrom: preset.cdrom ? path.basename(preset.cdrom) : "",
				memory: preset.memoryMb ? `${preset.memoryMb} MB` : "",
				headless: preset.headless ? "yes" : "no",
			})),
			{ title: "Saved QEMU presets" },
		),
	];
}

export function createQemuPresetDetailReport(preset: QemuVmPreset): OutputEntity[] {
	const detailRows: Array<{ property: string; value: string }> = [
		{ property: "id", value: preset.id },
		{ property: "name", value: preset.name },
		{ property: "role", value: preset.role ?? "vm" },
		{ property: "diskImage", value: formatOptionalString(preset.diskImage) },
		{ property: "diskFormat", value: formatOptionalString(preset.diskFormat) },
		{ property: "diskInterface", value: formatOptionalString(preset.diskInterface) },
		{ property: "cdrom", value: formatOptionalString(preset.cdrom) },
		{ property: "kernel", value: formatOptionalString(preset.kernel) },
		{ property: "initrd", value: formatOptionalString(preset.initrd) },
		{ property: "append", value: formatOptionalString(preset.append) },
		{ property: "memoryMb", value: formatOptionalNumber(preset.memoryMb, " MB") },
		{ property: "machine", value: formatOptionalString(preset.machine) },
		{ property: "accelerator", value: formatOptionalString(preset.accelerator) },
		{ property: "cpu", value: formatOptionalString(preset.cpu) },
		{ property: "smp", value: formatOptionalNumber(preset.smp) },
		{ property: "useProxy", value: formatOptionalBoolean(preset.useProxy) },
		{ property: "headless", value: formatOptionalBoolean(preset.headless) },
		{ property: "snapshot", value: formatOptionalBoolean(preset.snapshot) },
		{ property: "daemonize", value: formatOptionalBoolean(preset.daemonize) },
		{ property: "enableKvm", value: formatOptionalBoolean(preset.enableKvm) },
	].filter((row) => !row.value.startsWith("<none>") || ["diskImage", "cdrom"].includes(row.property));

	const entities: OutputEntity[] = [
		createTextEntity(
			[
				`QEMU preset • ${preset.name}`,
				`Id: ${preset.id}`,
				`Role: ${preset.role ?? "vm"}`,
				`Disk: ${formatOptionalString(preset.diskImage)}`,
			],
			{ title: "QEMU preset", tone: "info" },
		),
		createKeyValueTable("Preset details", detailRows),
	];

	if (preset.routerNetwork) {
		const routerRows = Object.entries(preset.routerNetwork)
			.filter(([, value]) => value !== undefined && value !== null && value !== "")
			.map(([property, value]) => ({ property, value: String(value) }));
		if (routerRows.length > 0) {
			entities.push(createKeyValueTable("Router network", routerRows));
		}
	}

	if (preset.args && preset.args.length > 0) {
		entities.push(createTableEntity(
			[
				{ key: "index", header: "#", align: "right", maxWidth: 6 },
				{ key: "argument", header: "argument", maxWidth: 96 },
			],
			preset.args.map((argument, index) => ({ index: index + 1, argument })),
			{ title: "Additional args" },
		));
	}

	return entities;
}

export function createQemuPreviewReport(
	preset: QemuVmPreset,
	preview: QemuCommandPreview,
): OutputEntity[] {
	return [
		createTextEntity(
			[
				`QEMU launch preview • ${preset.name}`,
				`Preset Id: ${preset.id}`,
				`Uses proxychains: ${preview.usesProxy ? "yes" : "no"}`,
				`Command args: ${preview.command.length}`,
			],
			{ title: "QEMU preview", tone: "info" },
		),
		createTextEntity(renderShellCommand(preview.command), {
			title: "Command",
			tone: "command",
		}),
		createTableEntity(
			[
				{ key: "index", header: "#", align: "right", maxWidth: 6 },
				{ key: "argument", header: "argument", maxWidth: 100 },
			],
			preview.command.map((argument, index) => ({ index: index + 1, argument })),
			{ title: "Command arguments" },
		),
	];
}

export function createQemuEnvironmentReport(report: QemuKitEnvironmentReport): OutputEntity[] {
	const dependencyRows = [
		{ component: "system", id: report.system.id, state: report.system.available ? "available" : "missing", binary: report.system.resolvedBinary ?? report.system.binary, path: report.system.resolvedPath ?? "<missing>" },
		{ component: "image", id: report.imageTool.id, state: report.imageTool.available ? "available" : "missing", binary: report.imageTool.resolvedBinary ?? report.imageTool.binary, path: report.imageTool.resolvedPath ?? "<missing>" },
		{ component: "proxy", id: report.proxy.id, state: report.config.useProxy ? (report.proxy.available ? "available" : "missing") : "disabled", binary: report.proxy.resolvedBinary ?? report.proxy.binary, path: report.config.useProxy ? (report.proxy.resolvedPath ?? "<missing>") : "<disabled>" },
	];
	const configRows = [
		{ property: "architecture", value: report.config.architecture },
		{ property: "machine", value: report.config.machine },
		{ property: "accelerator", value: report.config.accelerator ?? "<default>" },
		{ property: "memoryMb", value: `${report.config.memoryMb}` },
		{ property: "useProxy", value: report.config.useProxy ? "yes" : "no" },
		{ property: "systemDependencyId", value: report.config.systemDependencyId },
		{ property: "imageDependencyId", value: report.config.imageDependencyId },
		{ property: "proxyDependencyId", value: report.config.proxyDependencyId },
		{ property: "defaultArgs", value: report.config.defaultArgs.join(" ") || "<none>" },
	];

	return [
		createTextEntity(
			[
				"QEMU environment",
				`Tracked running processes: ${report.runningProcessCount}`,
				`Architecture: ${report.config.architecture}`,
				`Machine: ${report.config.machine}`,
			],
			{ title: "QEMU environment", tone: "info" },
		),
		createTableEntity(
			[
				{ key: "component", header: "component", maxWidth: 12 },
				{ key: "id", header: "id", maxWidth: 18 },
				{ key: "state", header: "state", maxWidth: 12 },
				{ key: "binary", header: "binary", maxWidth: 24 },
				{ key: "path", header: "path", maxWidth: 80 },
			],
			dependencyRows,
			{ title: "Dependencies" },
		),
		createKeyValueTable("Configuration", configRows),
	];
}

export function createQemuPresetSaveReport(
	kit: QemuKit,
	preset: QemuVmPreset,
	mode: "created" | "updated",
): OutputEntity[] {
	return [
		createTextEntity(
			[
				`${mode === "created" ? "Saved" : "Updated"} QEMU preset ${preset.name}`,
				`Id: ${preset.id}`,
				`Role: ${preset.role ?? "vm"}`,
				`Disk: ${formatOptionalString(preset.diskImage)}`,
			],
			{ title: "QEMU preset", tone: "info" },
		),
		...createQemuPresetDetailReport(preset),
		...createQemuPresetListReport(kit),
	];
}

export function createQemuPresetDeleteReport(
	kit: QemuKit,
	preset: QemuVmPreset,
): OutputEntity[] {
	return [
		createTextEntity(
			[
				`Deleted QEMU preset ${preset.name}`,
				`Id: ${preset.id}`,
				`Role: ${preset.role ?? "vm"}`,
			],
			{ title: "QEMU preset", tone: "info" },
		),
		...createQemuPresetListReport(kit),
	];
}