import {
	QemuKit,
	type QemuPrepareInstallerIsoResult,
} from "../../kits";
import { createTextEntity } from "../../primitives";
import { defineExecutor, defineModule, type ModuleConsoleParam } from "../module";

export type QemuPrepareInstallerParams = {
	target?: string;
	sourceIsoPath?: string;
	outputIsoPath?: string;
	overwrite?: boolean;
};

const QEMU_PREPARE_INSTALLER_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "target",
		detail: "Router preset id or name that owns the managed config.",
		valueType: "string",
		example: "target=router",
	},
	{
		name: "sourceIsoPath",
		detail: "Source installer ISO path to customize.",
		valueType: "string",
		example: "sourceIsoPath=data/opnsense.iso",
	},
	{
		name: "outputIsoPath",
		detail: "Destination path for the generated installer ISO.",
		valueType: "string",
		example: "outputIsoPath=data/qemu/opnsense-managed.iso",
	},
	{
		name: "overwrite",
		detail: "Allow replacing an existing output ISO.",
		valueType: "boolean",
		values: ["true", "false"],
		example: "overwrite=true",
	},
];

function resolveRouterTarget(kit: QemuKit, target: string | undefined): string {
	const normalizedTarget = target?.trim();
	if (normalizedTarget) {
		return normalizedTarget;
	}

	const routerPresets = kit.getPresets().filter((preset) => preset.role === "router");
	if (routerPresets.length === 1) {
		return routerPresets[0]!.id;
	}

	if (routerPresets.length === 0) {
		throw new Error("No router preset found. Create an OPNsense router preset first.");
	}

	throw new Error("Multiple router presets found. Pass target=<preset-id-or-name> explicitly.");
}

function renderPreparedInstallerSummary(result: QemuPrepareInstallerIsoResult) {
	return createTextEntity(
		[
			"QEMU router installer ISO prepared",
			`Preset: ${result.presetName}`,
			`Source ISO: ${result.sourceIsoPath}`,
			`Output ISO: ${result.outputIsoPath}`,
			`Embedded Config: ${result.embeddedConfigPath}`,
			`Config Source: ${result.configPath}`,
			`Overwrote Existing ISO: ${result.overwritten ? "yes" : "no"}`,
		],
		{ tone: "info" },
	);
}

const executor = defineExecutor<QemuPrepareInstallerParams>(async (context) => {
	let kit = context.getQemuKit();
	if (!kit) {
		kit = new QemuKit();
		await context.runtime.attachKit(kit, {
			reason: "module:kits/qemu/prepare-installer",
		});
	}

	const target = resolveRouterTarget(kit, context.params.target);
	context.logger.info({ target }, "Preparing reusable QEMU router installer ISO");

	const result = await kit.prepareRouterInstallerIso(target, {
		sourceIsoPath: context.params.sourceIsoPath,
		outputIsoPath: context.params.outputIsoPath,
		overwrite: context.params.overwrite,
	});

	context.logger.info(
		{
			target,
			sourceIsoPath: result.sourceIsoPath,
			outputIsoPath: result.outputIsoPath,
			overwritten: result.overwritten,
		},
		"Prepared reusable QEMU router installer ISO",
	);

	return renderPreparedInstallerSummary(result);
});

export const qemuPrepareInstallerModule = defineModule({
	id: "kits/qemu/prepare-installer",
	category: "kits",
	description: "Build a reusable OPNsense installer ISO with the managed router config embedded at /conf/config.xml",
	consoleParams: QEMU_PREPARE_INSTALLER_CONSOLE_PARAMS,
	executor,
}).useDefault("target");