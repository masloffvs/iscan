import { QemuKit } from "../../kits";
import { createTextEntity } from "../../primitives";
import { defineExecutor, defineModule, type ModuleConsoleParam } from "../module";
import { QEMU_NOTEBOOK_TYPE_OVERLAY } from "./qemu-shared";

export type QemuConnectParams = {
	architecture?: string;
	machine?: string;
	accelerator?: string;
	memoryMb?: number | string;
	useProxy?: boolean | string;
	systemDependencyId?: string;
	imageDependencyId?: string;
	proxyDependencyId?: string;
	defaultArgs?: string | readonly string[];
};

const QEMU_CONNECT_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "architecture",
		detail: "Target QEMU architecture.",
		valueType: "string",
		example: "architecture=x86_64",
	},
	{
		name: "machine",
		detail: "QEMU machine type.",
		valueType: "string",
		example: "machine=q35",
	},
	{
		name: "accelerator",
		detail: "Acceleration backend.",
		valueType: "string",
		example: "accelerator=kvm",
	},
	{
		name: "memoryMb",
		detail: "Default VM memory in megabytes.",
		valueType: "number",
		example: "memoryMb=4096",
	},
	{
		name: "useProxy",
		detail: "Route QEMU helper tools through proxychains when configured.",
		valueType: "boolean",
		values: ["true", "false"],
		example: "useProxy=false",
	},
	{
		name: "systemDependencyId",
		detail: "Manifest dependency id for the main QEMU system binary.",
		valueType: "string",
		example: "systemDependencyId=qemu-system-x86_64",
	},
	{
		name: "imageDependencyId",
		detail: "Manifest dependency id for image tooling like qemu-img.",
		valueType: "string",
		example: "imageDependencyId=qemu-img",
	},
	{
		name: "proxyDependencyId",
		detail: "Manifest dependency id for proxychains.",
		valueType: "string",
		example: "proxyDependencyId=proxychains4",
	},
	{
		name: "defaultArgs",
		detail: "Comma-separated default QEMU CLI args applied to launches.",
		valueType: "string[]",
		example: "defaultArgs=-display,cocoa,-smp,4",
	},
];

function normalizeBoolean(value: boolean | string | undefined, label: string): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value === "boolean") {
		return value;
	}

	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true;
	}

	if (["0", "false", "no", "off"].includes(normalized)) {
		return false;
	}

	throw new Error(`${label} must be a boolean.`);
}

function normalizePositiveInteger(value: number | string | undefined, label: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(numericValue) || numericValue < 1) {
		throw new Error(`${label} must be a positive integer.`);
	}

	return numericValue;
}

function normalizeArgs(value: string | readonly string[] | undefined): readonly string[] | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value === "string") {
		return value.split(",").map(item => item.trim()).filter(Boolean);
	}

	return value.map(item => item.trim()).filter(Boolean);
}

const executor = defineExecutor<QemuConnectParams>(async ({ params, runtime }) => {
	const kit = new QemuKit({
		architecture: params.architecture,
		machine: params.machine,
		accelerator: params.accelerator,
		memoryMb: normalizePositiveInteger(params.memoryMb, "memoryMb"),
		useProxy: normalizeBoolean(params.useProxy, "useProxy"),
		systemDependencyId: params.systemDependencyId,
		imageDependencyId: params.imageDependencyId,
		proxyDependencyId: params.proxyDependencyId,
		defaultArgs: normalizeArgs(params.defaultArgs),
	});

	const connectedKit = await runtime.attachKit(kit, {
		reason: "module:kits/qemu/connect",
	});
	const report = connectedKit.inspectEnvironment();

	return createTextEntity(
		[
			"QemuKit connected",
			`System Dependency: ${report.system.id}`,
			`System Binary: ${report.system.resolvedPath ?? "<missing>"}`,
			`Image Tool: ${report.imageTool.resolvedPath ?? "<missing>"}`,
			`Proxychains: ${report.config.useProxy ? (report.proxy.resolvedPath ?? "<missing>") : "disabled"}`,
			`Architecture: ${report.config.architecture}`,
			`Machine: ${report.config.machine}`,
			`Memory: ${report.config.memoryMb} MB`,
			`Default Args: ${report.config.defaultArgs.join(" ") || "<none>"}`,
		],
		{ tone: "info" },
	);
});

export const qemuConnectModule = defineModule({
	id: "kits/qemu/connect",
	category: "kits",
	description: "Connect an Activity-scoped QemuKit using manifest-managed external dependencies",
	notebookTypeOverlay: QEMU_NOTEBOOK_TYPE_OVERLAY,
	consoleParams: QEMU_CONNECT_CONSOLE_PARAMS,
	executor,
});