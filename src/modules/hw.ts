import {
	HW_KIT_ID,
	HwKit,
	type HwModuleLoadOptions,
	type HwModuleReloadOptions,
	type HwModuleUnloadOptions,
} from "../kits";
import { InvalidParamsError } from "./errors";
import { defineExecutor, defineModule, type ModuleExecutionContext } from "./module";

type EnsureHwKitContext = Pick<ModuleExecutionContext<unknown, object>, "getKit" | "runtime">;

export type HwDslParams = Record<string, unknown>;

type NormalizedHwDslParams = {
	config: Record<string, unknown>;
	values: unknown[];
};

type HwDslTerminalAction =
	| "drivers-check-info"
	| "drivers-current"
	| "drivers-find-for"
	| "list-pci"
	| "list-usb"
	| "module-load"
	| "module-reload"
	| "module-unload"
	| "suggest";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function ensureHwKit(
	context: EnsureHwKitContext,
	reason = "module:pkg/hw",
): Promise<HwKit> {
	const existingKit = context.getKit<HwKit>(HW_KIT_ID);
	if (existingKit) {
		return existingKit;
	}

	return await context.runtime.attachKit(new HwKit(), { reason });
}

function parseRequiredString(value: unknown, fieldName: string): string {
	if (typeof value !== "string") {
		throw new InvalidParamsError(`${fieldName} must be a string.`);
	}

	const normalizedValue = value.trim();
	if (normalizedValue.length === 0) {
		throw new InvalidParamsError(`${fieldName} must be a non-empty string.`);
	}

	return normalizedValue;
}

function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value !== "boolean") {
		throw new InvalidParamsError(`${fieldName} must be a boolean.`);
	}

	return value;
}

function parseBooleanFlag(record: Record<string, unknown>, key: string): boolean {
	return record[key] === true;
}

function normalizeHwDslParams(params: unknown): NormalizedHwDslParams {
	if (params === undefined) {
		return {
			config: {},
			values: [],
		};
	}

	const config: Record<string, unknown> = {};
	const values: unknown[] = [];
	const ingestValue = (value: unknown) => {
		if (isRecord(value)) {
			Object.assign(config, value);
			return;
		}

		if (value !== undefined) {
			values.push(value);
		}
	};

	if (Array.isArray(params)) {
		for (const value of params) {
			ingestValue(value);
		}

		return { config, values };
	}

	if (isRecord(params)) {
		const args = Array.isArray(params.args) ? params.args : [];
		for (const value of args) {
			ingestValue(value);
		}

		if (Object.prototype.hasOwnProperty.call(params, "value")) {
			ingestValue(params.value);
		}

		for (const [key, value] of Object.entries(params)) {
			if (key === "args" || key === "value") {
				continue;
			}

			config[key] = value;
		}

		return { config, values };
	}

	return {
		config,
		values: [params],
	};
}

function pickHwTerminalAction(config: Record<string, unknown>): HwDslTerminalAction {
	const actions: HwDslTerminalAction[] = [];

	if (parseBooleanFlag(config, "suggest")) {
		actions.push("suggest");
	}

	if (parseBooleanFlag(config, "list") && parseBooleanFlag(config, "pci")) {
		actions.push("list-pci");
	}

	if (parseBooleanFlag(config, "list") && parseBooleanFlag(config, "usb")) {
		actions.push("list-usb");
	}

	if (parseBooleanFlag(config, "drivers") && parseBooleanFlag(config, "current")) {
		actions.push("drivers-current");
	}

	if (parseBooleanFlag(config, "drivers") && parseBooleanFlag(config, "findFor")) {
		actions.push("drivers-find-for");
	}

	if (parseBooleanFlag(config, "drivers") && parseBooleanFlag(config, "checkInfo")) {
		actions.push("drivers-check-info");
	}

	if (parseBooleanFlag(config, "module") && parseBooleanFlag(config, "load")) {
		actions.push("module-load");
	}

	if (parseBooleanFlag(config, "module") && parseBooleanFlag(config, "unload")) {
		actions.push("module-unload");
	}

	if (parseBooleanFlag(config, "module") && parseBooleanFlag(config, "reload")) {
		actions.push("module-reload");
	}

	if (actions.length === 0) {
		throw new InvalidParamsError(
			"Incomplete $.pkg.hw chain. Finish with .list.pci(), .list.usb(), .drivers.current(), .drivers.findFor(...), .drivers.checkInfo(...), .module(...).load(...), .module(...).unload(...), .module(...).reload(), or .suggest().",
		);
	}

	if (actions.length > 1) {
		throw new InvalidParamsError("Use only one terminal hardware action per chain.");
	}

	return actions[0] ?? "suggest";
}

function readPositionalString(config: Record<string, unknown>, values: unknown[], fieldNames: readonly string[], fieldName: string): string {
	for (const candidateField of fieldNames) {
		if (candidateField in config && config[candidateField] !== undefined) {
			return parseRequiredString(config[candidateField], fieldName);
		}
	}

	if (values.length === 0) {
		throw new InvalidParamsError(`${fieldName} is required.`);
	}

	return parseRequiredString(values[0], fieldName);
}

function buildModuleLoadOptions(config: Record<string, unknown>, values: unknown[]): { name: string; options: HwModuleLoadOptions } {
	const name = readPositionalString(config, values, ["name", "moduleName"], "module name");
	const fallbackParams = values.slice(1);
	const paramsValue = config.params ?? (fallbackParams.length > 0 ? fallbackParams : undefined);
	return {
		name,
		options: paramsValue === undefined ? {} : { params: paramsValue as string | string[] },
	};
}

function buildModuleUnloadOptions(config: Record<string, unknown>, values: unknown[]): { name: string; options: HwModuleUnloadOptions } {
	const force = parseOptionalBoolean(config.force, "force");
	return {
		name: readPositionalString(config, values, ["name", "moduleName"], "module name"),
		options: force === undefined ? {} : { force },
	};
}

function buildModuleReloadOptions(config: Record<string, unknown>, values: unknown[]): { name: string; options: HwModuleReloadOptions } {
	const name = readPositionalString(config, values, ["name", "moduleName"], "module name");
	const fallbackParams = values.slice(1);
	const paramsValue = config.params ?? (fallbackParams.length > 0 ? fallbackParams : undefined);
	const force = parseOptionalBoolean(config.force, "force");
	return {
		name,
		options: {
			...(force !== undefined ? { force } : {}),
			...(paramsValue !== undefined ? { params: paramsValue as string | string[] } : {}),
		},
	};
}

export const hwDslModule = defineModule<HwDslParams, unknown>({
	id: "pkg/hw",
	category: "pkg",
	description: "Host-side hardware and driver DSL root for $.pkg.hw list/drivers/module/suggest flows.",
	consoleParams: [
		{ name: "list", detail: "Activate the list namespace.", jsDescriptorName: "list", valueType: "boolean" },
		{ name: "pci", detail: "List PCI devices and their kernel driver bindings.", jsDescriptorName: "pci", valueType: "boolean" },
		{ name: "usb", detail: "List USB devices from the host.", jsDescriptorName: "usb", valueType: "boolean" },
		{ name: "drivers", detail: "Activate the drivers namespace.", jsDescriptorName: "drivers", valueType: "boolean" },
		{ name: "current", detail: "List currently loaded kernel modules.", jsDescriptorName: "current", valueType: "boolean" },
		{ name: "findFor", detail: "Inspect the current driver and candidate modules for one PCI address.", jsDescriptorName: "findFor", valueType: "boolean" },
		{ name: "checkInfo", detail: "Inspect detailed modinfo metadata for one kernel module.", jsDescriptorName: "checkInfo", valueType: "boolean" },
		{ name: "module", detail: "Activate the kernel module mutation namespace.", jsDescriptorName: "module", valueType: "boolean" },
		{ name: "load", detail: "Load a kernel module through modprobe.", jsDescriptorName: "load", valueType: "boolean" },
		{ name: "unload", detail: "Unload a kernel module through rmmod.", jsDescriptorName: "unload", valueType: "boolean" },
		{ name: "reload", detail: "Reload a kernel module through rmmod + modprobe.", jsDescriptorName: "reload", valueType: "boolean" },
		{ name: "suggest", detail: "Suggest candidate kernel modules for PCI devices based on lspci -k and installed modules.", jsDescriptorName: "suggest", valueType: "boolean" },
		{ name: "name", detail: "Kernel module name for drivers.checkInfo() or module(...).", example: "ath9k", valueType: "string" },
		{ name: "address", detail: "PCI address for drivers.findFor(...).", example: "0000:02:00.0", valueType: "string" },
		{ name: "params", detail: "Optional modprobe parameters as a string or array of strings.", example: "rtw_country_code=DE", valueType: "json" },
		{ name: "force", detail: "Force rmmod during unload or reload.", example: "true", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureHwKit(context, "module:pkg/hw");
		const { config, values } = normalizeHwDslParams(context.params);
		const action = pickHwTerminalAction(config);

		if (action === "list-pci") {
			return await kit.listPciDevices();
		}

		if (action === "list-usb") {
			return await kit.listUsbDevices();
		}

		if (action === "drivers-current") {
			return await kit.listLoadedModules();
		}

		if (action === "drivers-find-for") {
			const address = readPositionalString(config, values, ["address", "device", "deviceAddr"], "device address");
			return await kit.findDriverForDevice(address);
		}

		if (action === "drivers-check-info") {
			const moduleName = readPositionalString(config, values, ["name", "moduleName", "module"], "module name");
			return await kit.getModuleInfo(moduleName);
		}

		if (action === "module-load") {
			const { name, options } = buildModuleLoadOptions(config, values);
			return await kit.loadModule(name, options);
		}

		if (action === "module-unload") {
			const { name, options } = buildModuleUnloadOptions(config, values);
			return await kit.unloadModule(name, options);
		}

		if (action === "module-reload") {
			const { name, options } = buildModuleReloadOptions(config, values);
			return await kit.reloadModule(name, options);
		}

		return await kit.suggestDrivers();
	}),
});