import { defineExecutor, defineModule } from "../module";
import { InvalidParamsError } from "../errors";
import {
	QEMU_DISK_INTERFACE_VALUES,
	QEMU_VM_ROLE_VALUES,
	createQemuPresetSaveReport,
	ensureQemuKit,
	ensureUniqueQemuPresetName,
	findQemuPreset,
	parseOptionalBoolean,
	parseOptionalDiskInterface,
	parseOptionalPositiveInteger,
	parseOptionalQemuRole,
	parseOptionalRouterNetworkConfig,
	parseOptionalString,
	parseOptionalStringArray,
	resolveQemuPreset,
} from "./qemu-shared";

export type QemuSaveParams = {
	target?: string;
	id?: string;
	name?: string;
	role?: string;
	diskImage?: string;
	diskFormat?: string;
	diskInterface?: string;
	cdrom?: string;
	kernel?: string;
	initrd?: string;
	append?: string;
	memoryMb?: number | string;
	machine?: string;
	accelerator?: string;
	cpu?: string;
	smp?: number | string;
	useProxy?: boolean | string;
	headless?: boolean | string;
	snapshot?: boolean | string;
	daemonize?: boolean | string;
	enableKvm?: boolean | string;
	args?: string | readonly string[];
	routerNetworkJson?: string | Record<string, unknown>;
};

const QEMU_SAVE_CONSOLE_PARAMS = [
	{ name: "target", detail: "Existing preset id or unique name to update. If omitted, creates a new preset unless id/name already matches one.", example: "router", valueType: "string" },
	{ name: "id", detail: "Stable preset id. Defaults to the existing id or a generated uuid when creating a new preset.", example: "router", valueType: "string" },
	{ name: "name", detail: "Human-readable preset name.", example: "Router", valueType: "string" },
	{ name: "role", detail: "Optional preset role.", example: "router", valueType: "string", values: QEMU_VM_ROLE_VALUES },
	{ name: "diskImage", detail: "Path to the VM disk image.", example: "/vm/router.qcow2", valueType: "string" },
	{ name: "diskFormat", detail: "Disk image format.", example: "qcow2", valueType: "string" },
	{ name: "diskInterface", detail: "QEMU disk interface.", example: "virtio", valueType: "string", values: QEMU_DISK_INTERFACE_VALUES },
	{ name: "cdrom", detail: "Optional installer ISO path. Pass an empty string to clear it.", example: "/iso/opnsense.iso", valueType: "string" },
	{ name: "kernel", detail: "Optional kernel path.", example: "/boot/vmlinuz", valueType: "string" },
	{ name: "initrd", detail: "Optional initrd path.", example: "/boot/initrd.img", valueType: "string" },
	{ name: "append", detail: "Optional kernel append string.", example: "console=ttyS0", valueType: "string" },
	{ name: "memoryMb", detail: "Optional preset memory override in MB.", example: "4096", valueType: "number" },
	{ name: "machine", detail: "Optional QEMU machine override.", example: "q35", valueType: "string" },
	{ name: "accelerator", detail: "Optional accelerator override.", example: "kvm", valueType: "string" },
	{ name: "cpu", detail: "Optional CPU model.", example: "host", valueType: "string" },
	{ name: "smp", detail: "Optional SMP override.", example: "4", valueType: "number" },
	{ name: "useProxy", detail: "Route this preset through proxychains when launching.", example: "useProxy=true", valueType: "boolean", values: ["true", "false"] },
	{ name: "headless", detail: "Run the preset without a graphical display.", example: "headless=true", valueType: "boolean", values: ["true", "false"] },
	{ name: "snapshot", detail: "Launch with QEMU snapshot mode.", example: "snapshot=true", valueType: "boolean", values: ["true", "false"] },
	{ name: "daemonize", detail: "Launch the preset as a background QEMU process.", example: "daemonize=true", valueType: "boolean", values: ["true", "false"] },
	{ name: "enableKvm", detail: "Explicitly enable or disable KVM.", example: "enableKvm=true", valueType: "boolean", values: ["true", "false"] },
	{ name: "args", detail: "Additional QEMU args as comma-separated values or a string array.", example: "args=-serial,stdio", valueType: "string[]" },
	{ name: "routerNetworkJson", detail: "Optional router network config as JSON.", example: '{"hostname":"router","domain":"lab.local","lanAddress":"192.168.1.1","lanPrefix":24}', valueType: "json" },
] as const;

function hasOwnParam<T extends object>(params: T, key: keyof T): boolean {
	return Object.prototype.hasOwnProperty.call(params, key);
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
	const normalized = parseOptionalString(value, fieldName);
	if (!normalized) {
		throw new InvalidParamsError(`${fieldName} is required.`);
	}

	return normalized;
}

export const qemuSaveModule = defineModule<QemuSaveParams>({
	id: "kits/qemu/save",
	aliases: ["kits/qemu/upsert"],
	category: "kits",
	description: "Create or update a saved QEMU preset for notebook-safe preset CRUD",
	consoleParams: QEMU_SAVE_CONSOLE_PARAMS,
	executor: defineExecutor<QemuSaveParams>(async (context) => {
		const kit = await ensureQemuKit(context, "Saving QEMU preset");
		const target = parseOptionalString(context.params.target, "target");
		const requestedId = parseOptionalString(context.params.id, "id");
		const requestedName = parseOptionalString(context.params.name, "name");
		const seed = target
			? resolveQemuPreset(kit, target)
			: findQemuPreset(kit, requestedId) ?? findQemuPreset(kit, requestedName);

		if (seed && requestedId && requestedId !== seed.id) {
			throw new InvalidParamsError(
				"Changing QEMU preset ids during save/update is not supported. Create a new preset instead.",
			);
		}

		const name = hasOwnParam(context.params, "name")
			? requireNonEmptyString(context.params.name, "name")
			: seed?.name;

		if (!name) {
			throw new InvalidParamsError("name is required when creating a new QEMU preset.");
		}

		const nextPreset = {
			id: seed?.id ?? requestedId ?? crypto.randomUUID(),
			name,
			role: hasOwnParam(context.params, "role")
				? parseOptionalQemuRole(context.params.role, "role")
				: seed?.role,
			diskImage: hasOwnParam(context.params, "diskImage")
				? parseOptionalString(context.params.diskImage, "diskImage")
				: seed?.diskImage,
			diskFormat: hasOwnParam(context.params, "diskFormat")
				? parseOptionalString(context.params.diskFormat, "diskFormat")
				: seed?.diskFormat,
			diskInterface: hasOwnParam(context.params, "diskInterface")
				? parseOptionalDiskInterface(context.params.diskInterface, "diskInterface")
				: seed?.diskInterface,
			cdrom: hasOwnParam(context.params, "cdrom")
				? parseOptionalString(context.params.cdrom, "cdrom")
				: seed?.cdrom,
			kernel: hasOwnParam(context.params, "kernel")
				? parseOptionalString(context.params.kernel, "kernel")
				: seed?.kernel,
			initrd: hasOwnParam(context.params, "initrd")
				? parseOptionalString(context.params.initrd, "initrd")
				: seed?.initrd,
			append: hasOwnParam(context.params, "append")
				? parseOptionalString(context.params.append, "append")
				: seed?.append,
			memoryMb: hasOwnParam(context.params, "memoryMb")
				? parseOptionalPositiveInteger(context.params.memoryMb, "memoryMb")
				: seed?.memoryMb,
			machine: hasOwnParam(context.params, "machine")
				? parseOptionalString(context.params.machine, "machine")
				: seed?.machine,
			accelerator: hasOwnParam(context.params, "accelerator")
				? parseOptionalString(context.params.accelerator, "accelerator")
				: seed?.accelerator,
			cpu: hasOwnParam(context.params, "cpu")
				? parseOptionalString(context.params.cpu, "cpu")
				: seed?.cpu,
			smp: hasOwnParam(context.params, "smp")
				? parseOptionalPositiveInteger(context.params.smp, "smp")
				: seed?.smp,
			useProxy: hasOwnParam(context.params, "useProxy")
				? parseOptionalBoolean(context.params.useProxy, "useProxy")
				: seed?.useProxy,
			headless: hasOwnParam(context.params, "headless")
				? parseOptionalBoolean(context.params.headless, "headless")
				: seed?.headless,
			snapshot: hasOwnParam(context.params, "snapshot")
				? parseOptionalBoolean(context.params.snapshot, "snapshot")
				: seed?.snapshot,
			daemonize: hasOwnParam(context.params, "daemonize")
				? parseOptionalBoolean(context.params.daemonize, "daemonize")
				: seed?.daemonize,
			enableKvm: hasOwnParam(context.params, "enableKvm")
				? parseOptionalBoolean(context.params.enableKvm, "enableKvm")
				: seed?.enableKvm,
			args: hasOwnParam(context.params, "args")
				? parseOptionalStringArray(context.params.args, "args")
				: seed?.args,
			routerNetwork: hasOwnParam(context.params, "routerNetworkJson")
				? parseOptionalRouterNetworkConfig(context.params.routerNetworkJson, "routerNetworkJson")
				: seed?.routerNetwork,
		};

		ensureUniqueQemuPresetName(kit, nextPreset.name, { excludeId: nextPreset.id });
		await kit.savePreset(nextPreset);
		const savedPreset = resolveQemuPreset(kit, nextPreset.id);
		return createQemuPresetSaveReport(kit, savedPreset, seed ? "updated" : "created");
	}),
});