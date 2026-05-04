import { QemuKit, type QemuRouterBootstrapResult } from "../../kits";
import { createTextEntity } from "../../primitives";
import { defineExecutor, defineModule, type ModuleConsoleParam } from "../module";

export type QemuBootstrapParams = {
	target?: string;
	username?: string;
	password?: string;
	rebootAfterRestore?: boolean;
};

const QEMU_BOOTSTRAP_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "target",
		detail: "Router preset id or name to bootstrap. If omitted and there is one router preset, it is auto-selected.",
		valueType: "string",
		example: "target=router",
	},
	{
		name: "username",
		detail: "Explicit router web UI username for bootstrap.",
		valueType: "string",
		example: "username=root",
	},
	{
		name: "password",
		detail: "Explicit router web UI password for bootstrap.",
		valueType: "string",
		example: "password=opnsense",
	},
	{
		name: "rebootAfterRestore",
		detail: "Wait for a reboot after config restore.",
		valueType: "boolean",
		values: ["true", "false"],
		example: "rebootAfterRestore=true",
	},
];

function resolveBootstrapTarget(kit: QemuKit, target: string | undefined): string {
	const normalizedTarget = target?.trim();
	if (normalizedTarget) {
		return normalizedTarget;
	}

	const routerPresets = kit.getPresets().filter(preset => preset.role === "router");
	if (routerPresets.length === 1) {
		return routerPresets[0]!.id;
	}

	if (routerPresets.length === 0) {
		throw new Error("No router preset found. Create an OPNsense router preset first.");
	}

	throw new Error("Multiple router presets found. Pass target=<preset-id-or-name> explicitly.");
}

function renderBootstrapSummary(result: QemuRouterBootstrapResult) {
	return createTextEntity(
		[
			result.skipped ? "QEMU router bootstrap skipped" : "QEMU router bootstrap finished",
			`Preset: ${result.presetName}`,
			`Initial State: ${result.initialState.status}`,
			`Final State: ${result.finalState.status}`,
			`Detached Installer ISO: ${result.detachedInstallerMedia ? "yes" : "no"}`,
			`Reboot Requested: ${result.rebootRequested ? "yes" : "no"}`,
			`Steps: ${result.steps.length}`,
			`Reason: ${result.finalState.reason}`,
		],
		{ tone: result.skipped ? "muted" : "info" },
	);
}

const executor = defineExecutor<QemuBootstrapParams>(async (context) => {
	let kit = context.getQemuKit();
	if (!kit) {
		kit = new QemuKit();
		await context.runtime.attachKit(kit, {
			reason: "module:kits/qemu/bootstrap",
		});
	}

	const target = resolveBootstrapTarget(kit, context.params.target);
	context.logger.info({ target }, "Starting explicit QEMU router bootstrap");

	const result = await kit.bootstrapPreset(target, {
		throwOnUnknown: true,
		username: context.params.username,
		password: context.params.password,
		rebootAfterRestore: context.params.rebootAfterRestore,
		onProgress: (progress) => {
			context.logger.info(
				{ target, stage: progress.stage, createdAt: progress.createdAt },
				progress.message,
			);
		},
	});

	context.logger.info(
		{
			target,
			initialState: result.initialState.status,
			finalState: result.finalState.status,
			skipped: result.skipped,
			detachedInstallerMedia: result.detachedInstallerMedia,
			rebootRequested: result.rebootRequested,
		},
		"Finished explicit QEMU router bootstrap",
	);

	return renderBootstrapSummary(result);
});

export const qemuBootstrapModule = defineModule({
	id: "kits/qemu/bootstrap",
	category: "kits",
	description: "Run router bootstrap explicitly and stream progress through the runtime log output",
	consoleParams: QEMU_BOOTSTRAP_CONSOLE_PARAMS,
	executor,
}).useDefault("target");