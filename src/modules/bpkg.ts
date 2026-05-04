import { createBpkgBindingConsoleParams, getBpkgBindingDefinition, registeredBpkgPackages } from "../bpkg";
import {
	BPKG_KIT_ID,
	BpkgKit,
	type BpkgBindingExecutionResult,
	type BpkgBoxRecord,
	type BpkgCommandResult,
	type BpkgInstallResult,
	type BpkgListResult,
	type BpkgSupportedPackageSummary,
} from "../kits";
import { InvalidParamsError } from "./errors";
import { defineExecutor, defineModule, type ModuleDefinition, type ModuleExecutionContext } from "./module";

type EnsureBpkgKitContext = Pick<ModuleExecutionContext<unknown, object>, "getKit" | "runtime">;

export type BpkgCreateParams = {
	description?: string;
	id?: string;
	name?: string;
	packages?: readonly string[] | string;
};

export type BpkgGetParams = {
	boxId?: string;
	id?: string;
};

export type BpkgInstallParams = {
	boxId?: string;
	packages?: readonly string[] | string;
	target?: string;
};

export type BpkgSelectParams = {
	boxId?: string;
	id?: string;
};

export type BpkgUseExecParams = {
	boxId?: string;
	command?: string;
	cwd?: string;
	env?: Record<string, string>;
	argv?: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function ensureBpkgKit(
	context: EnsureBpkgKitContext,
	reason = "module:bpkg",
): Promise<BpkgKit> {
	const existingKit = context.getKit<BpkgKit>(BPKG_KIT_ID);
	if (existingKit) {
		if (!existingKit.isActive()) {
			await existingKit.start({ reason });
		}
		return existingKit;
	}

	return await context.runtime.attachKit(new BpkgKit(), { reason });
}

function parseOptionalString(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value !== "string") {
		throw new InvalidParamsError(`${fieldName} must be a string.`);
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function parseRequiredString(value: unknown, fieldName: string): string {
	const normalized = parseOptionalString(value, fieldName);
	if (!normalized) {
		throw new InvalidParamsError(`${fieldName} must be a non-empty string.`);
	}

	return normalized;
}

function parseOptionalStringArray(value: unknown, fieldName: string): readonly string[] | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (Array.isArray(value)) {
		return value.map((entry, index) => parseRequiredString(entry, `${fieldName}[${index}]`));
	}

	if (typeof value === "string") {
		const entries = value
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
		if (entries.length === 0) {
			throw new InvalidParamsError(`${fieldName} must contain at least one value.`);
		}

		return entries;
	}

	throw new InvalidParamsError(`${fieldName} must be a string or string array.`);
}

function parseStringMap(value: unknown, fieldName: string): Record<string, string> | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (!isRecord(value)) {
		throw new InvalidParamsError(`${fieldName} must be an object.`);
	}

	return Object.fromEntries(
		Object.entries(value).map(([key, entryValue]) => [key, parseRequiredString(entryValue, `${fieldName}.${key}`)]),
	);
}

function normalizeCreateParams(params: BpkgCreateParams): Required<Pick<BpkgCreateParams, "id">> & Omit<BpkgCreateParams, "id"> {
	const id = parseRequiredString(params.id, "id");
	return {
		...params,
		id,
		packages: parseOptionalStringArray(params.packages, "packages"),
	};
}

function normalizeTargetBoxId(params: BpkgGetParams | BpkgSelectParams | BpkgInstallParams): string | undefined {
	return parseOptionalString(params.boxId ?? params.id ?? params.target, "boxId");
}

function normalizeUseExecParams(params: unknown): BpkgUseExecParams {
	if (Array.isArray(params)) {
		if (params.length < 2) {
			throw new InvalidParamsError("$.bpkg.use(...).exec(...) requires a box id and a command payload.");
		}

		const [boxValue, executionValue] = params;
		if (typeof executionValue === "string") {
			return {
				boxId: parseRequiredString(boxValue, "boxId"),
				command: parseRequiredString(executionValue, "command"),
			};
		}

		if (isRecord(executionValue)) {
			return {
				argv: parseOptionalStringArray(executionValue.argv, "argv"),
				boxId: parseRequiredString(boxValue, "boxId"),
				command: parseOptionalString(executionValue.command, "command"),
				cwd: parseOptionalString(executionValue.cwd, "cwd"),
				env: parseStringMap(executionValue.env, "env"),
			};
		}

		throw new InvalidParamsError("$.bpkg.use(...).exec(...) expects a string command or an execution object.");
	}

	if (!isRecord(params)) {
		throw new InvalidParamsError("bpkg/use/exec expects an object or the JS chain form $.bpkg.use(\"box\").exec(...)." );
	}

	return {
		argv: parseOptionalStringArray(params.argv, "argv"),
		boxId: parseOptionalString(params.boxId, "boxId"),
		command: parseOptionalString(params.command, "command"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		env: parseStringMap(params.env, "env"),
	};
}

export const bpkgListModule = defineModule<undefined, BpkgListResult>({
	id: "bpkg/list",
	category: "bpkg",
	description: "List bpkg boxes and current host capabilities.",
	executor: defineExecutor(async (context) => {
		const kit = await ensureBpkgKit(context, "module:bpkg/list");
		return kit.inspect();
	}),
});

export const bpkgPackagesModule = defineModule<undefined, BpkgSupportedPackageSummary[]>({
	id: "bpkg/packages",
	category: "bpkg",
	description: "List supported bpkg packages and their generated bindings.",
	executor: defineExecutor(async (context) => {
		const kit = await ensureBpkgKit(context, "module:bpkg/packages");
		return kit.listSupportedPackages();
	}),
});

export const bpkgGetModule = defineModule<BpkgGetParams, BpkgBoxRecord | null>({
	id: "bpkg/get",
	category: "bpkg",
	description: "Get a bpkg box by id, or the selected default box when omitted.",
	consoleParams: [
		{ name: "boxId", detail: "Optional bpkg box id", example: "metasploit", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureBpkgKit(context, "module:bpkg/get");
		const boxId = normalizeTargetBoxId(context.params);
		return boxId ? kit.getBox(boxId) : kit.getDefaultBox();
	}),
}).useDefault("boxId");

export const bpkgCreateModule = defineModule<BpkgCreateParams, BpkgBoxRecord>({
	id: "bpkg/create",
	category: "bpkg",
	description: "Create or refresh an Arch bpkg box and optionally install supported packages into it.",
	consoleParams: [
		{ name: "id", detail: "Box id", example: "metasploit", required: true, valueType: "string" },
		{ name: "name", detail: "Display name for the box", example: "Metasploit", valueType: "string" },
		{ name: "description", detail: "Optional description", valueType: "string" },
		{ name: "packages", detail: "Supported bpkg package ids to install after bootstrap", example: "metasploit", valueType: "string[]" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureBpkgKit(context, "module:bpkg/create");
		return await kit.createBox(normalizeCreateParams(context.params));
	}),
}).useDefault("id");

export const bpkgSelectModule = defineModule<BpkgSelectParams, BpkgBoxRecord>({
	id: "bpkg/select",
	category: "bpkg",
	description: "Select the default bpkg box used by generated $.pkg.* helpers.",
	consoleParams: [
		{ name: "boxId", detail: "Box id to select", example: "metasploit", required: true, valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureBpkgKit(context, "module:bpkg/select");
		const boxId = normalizeTargetBoxId(context.params);
		if (!boxId) {
			throw new InvalidParamsError("boxId is required.");
		}

		return await kit.selectDefaultBox(boxId);
	}),
}).useDefault("boxId");

export const bpkgInstallModule = defineModule<BpkgInstallParams, BpkgInstallResult>({
	id: "bpkg/install",
	category: "bpkg",
	description: "Install supported bpkg packages into a target box or the current default box.",
	consoleParams: [
		{ name: "packages", detail: "Supported bpkg package ids", example: "metasploit", required: true, valueType: "string[]" },
		{ name: "boxId", detail: "Optional target box id; defaults to the selected box", example: "metasploit", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureBpkgKit(context, "module:bpkg/install");
		const packages = parseOptionalStringArray(context.params.packages, "packages");
		if (!packages || packages.length === 0) {
			throw new InvalidParamsError("packages must contain at least one supported bpkg package id.");
		}

		return await kit.installSupportedPackages(packages, normalizeTargetBoxId(context.params));
	}),
}).useDefault("packages");

export const bpkgUseExecModule = defineModule<unknown, BpkgCommandResult>({
	id: "bpkg/use/exec",
	category: "bpkg",
	description: "Execute a raw command inside a selected bpkg box via $.bpkg.use(\"box\").exec(...).",
	consoleParams: [
		{ name: "boxId", detail: "Target box id", example: "metasploit", required: true, valueType: "string" },
		{ name: "command", detail: "Shell command to execute inside the box", example: "msfconsole -q", valueType: "string" },
		{ name: "cwd", detail: "Optional working directory inside the box", example: "/root", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureBpkgKit(context, "module:bpkg/use/exec");
		const normalized = normalizeUseExecParams(context.params);
		if (!normalized.boxId) {
			throw new InvalidParamsError("boxId is required for bpkg/use/exec.");
		}
		if (!normalized.command && (!normalized.argv || normalized.argv.length === 0)) {
			throw new InvalidParamsError("bpkg/use/exec requires command or argv.");
		}

		return await kit.executeBoxCommand(normalized.boxId, normalized);
	}),
});

function createGeneratedPackageBindingModule(
	packageId: string,
	bindingId: string,
): ModuleDefinition<Record<string, unknown>, BpkgBindingExecutionResult, object> {
	const packageDefinition = registeredBpkgPackages.find((entry) => entry.id === packageId);
	if (!packageDefinition) {
		throw new Error(`Unsupported bpkg package '${packageId}'.`);
	}

	const bindingDefinition = getBpkgBindingDefinition(packageDefinition, bindingId);
	const module = defineModule<Record<string, unknown>, BpkgBindingExecutionResult>({
		id: `pkg/${packageId}/${bindingId}`,
		category: "pkg",
		description: `${bindingDefinition.description} Uses the selected default bpkg box.`,
		consoleParams: createBpkgBindingConsoleParams(packageDefinition, bindingId),
		executor: defineExecutor(async (context) => {
			const kit = await ensureBpkgKit(context, `module:pkg/${packageId}/${bindingId}`);
			return await kit.executePackageBinding(packageId, bindingId, context.params);
		}),
	});

	return bindingDefinition.defaultParameterName
		? module.useDefault(bindingDefinition.defaultParameterName)
		: module;
}

export const bpkgGeneratedPackageModules = registeredBpkgPackages.flatMap((packageDefinition) =>
	Object.keys(packageDefinition.bindings).map((bindingId) =>
		createGeneratedPackageBindingModule(packageDefinition.id, bindingId),
	),
);