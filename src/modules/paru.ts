import {
	PACMAN_KIT_ID,
	PacmanKit,
	type AurDownloadOptions,
	type AurDownloadResult,
	type AurInspectResult,
	type AurSearchResult,
	type PackageManagerTransactionResult,
	type ParuConfig,
	type ParuExecutionOptions,
	type ParuInstallOptions,
	type ParuRemoveOptions,
	type ParuUpdateOptions,
} from "../kits";
import { InvalidParamsError } from "./errors";
import { defineExecutor, defineModule, type ModuleExecutionContext } from "./module";

type EnsurePacmanKitContext = Pick<ModuleExecutionContext<unknown, object>, "getKit" | "runtime">;

type ParuConfigSetParams = Partial<ParuConfig>;

export type ParuInstallParams = ParuInstallOptions & {
	packages?: readonly string[] | string;
};

export type ParuRemoveParams = ParuRemoveOptions & {
	packages?: readonly string[] | string;
};

export type ParuAurSearchParams = {
	query?: string;
};

export type ParuAurInspectParams = {
	packageName?: string;
	pkg?: string;
};

export type ParuAurDownloadParams = AurDownloadOptions & {
	packageName?: string;
	pkg?: string;
};

async function ensurePacmanKit(
	context: EnsurePacmanKitContext,
	reason = "module:paru",
): Promise<PacmanKit> {
	const existingKit = context.getKit<PacmanKit>(PACMAN_KIT_ID);
	if (existingKit) {
		return existingKit;
	}

	return await context.runtime.attachKit(new PacmanKit(), { reason });
}

function parseOptionalString(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value !== "string") {
		throw new InvalidParamsError(`${fieldName} must be a string.`);
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function parseRequiredString(value: unknown, fieldName: string): string {
	const normalizedValue = parseOptionalString(value, fieldName);
	if (!normalizedValue) {
		throw new InvalidParamsError(`${fieldName} must be a non-empty string.`);
	}

	return normalizedValue;
}

function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
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

function parseOptionalStringArray(value: unknown, fieldName: string): readonly string[] | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value === "string") {
		const values = value.split(",").map((entry) => entry.trim()).filter(Boolean);
		return values.length > 0 ? values : undefined;
	}

	if (Array.isArray(value)) {
		return value.map((entry, index) => parseRequiredString(entry, `${fieldName}[${index}]`));
	}

	throw new InvalidParamsError(`${fieldName} must be a string or string array.`);
}

function parseRequiredStringArray(value: unknown, fieldName: string): readonly string[] {
	const parsedValue = parseOptionalStringArray(value, fieldName);
	if (!parsedValue || parsedValue.length === 0) {
		throw new InvalidParamsError(`${fieldName} must contain at least one value.`);
	}

	return parsedValue;
}

function normalizeParuConfigPatch(params: ParuConfigSetParams): Partial<ParuConfig> {
	return {
		...(params.executable !== undefined ? { executable: parseRequiredString(params.executable, "executable") } : {}),
		...(params.fm !== undefined ? { fm: parseRequiredString(params.fm, "fm") } : {}),
		...(params.saveChanges !== undefined ? { saveChanges: parseOptionalBoolean(params.saveChanges, "saveChanges") } : {}),
	} as Partial<ParuConfig>;
}

function normalizeExecutionOptions<T extends { executable?: unknown; fm?: unknown; needed?: unknown; noconfirm?: unknown; saveChanges?: unknown; sudo?: unknown }>(params: T): Partial<PacmanKit extends never ? never : never> {
	return {
		executable: parseOptionalString(params.executable, "executable"),
		fm: parseOptionalString(params.fm, "fm"),
		needed: parseOptionalBoolean(params.needed, "needed"),
		noconfirm: parseOptionalBoolean(params.noconfirm, "noconfirm"),
		saveChanges: parseOptionalBoolean(params.saveChanges, "saveChanges"),
		sudo: parseOptionalBoolean(params.sudo, "sudo"),
	} as Partial<ParuExecutionOptions>;
}

function normalizeInstallParams(params: ParuInstallParams): { options: ParuInstallOptions; packages: readonly string[] } {
	return {
		options: normalizeExecutionOptions(params) as ParuInstallOptions,
		packages: parseRequiredStringArray(params.packages, "packages"),
	};
}

function normalizeRemoveParams(params: ParuRemoveParams): { options: ParuRemoveOptions; packages: readonly string[] } {
	return {
		options: {
			...(normalizeExecutionOptions(params) as ParuExecutionOptions),
			purge: parseOptionalBoolean(params.purge, "purge"),
			recursive: parseOptionalBoolean(params.recursive, "recursive"),
		},
		packages: parseRequiredStringArray(params.packages, "packages"),
	};
}

function normalizeAurQuery(params: ParuAurSearchParams): string {
	return parseRequiredString(params.query, "query");
}

function normalizeAurPackageName(params: ParuAurInspectParams | ParuAurDownloadParams): string {
	return parseRequiredString((params as ParuAurInspectParams).packageName ?? (params as ParuAurInspectParams).pkg, "packageName");
}

const PARU_CONFIG_CONSOLE_PARAMS = [
	{ name: "executable", detail: "Override the paru executable name", example: "paru", valueType: "string" },
	{ name: "fm", detail: "Preferred file manager for manual PKGBUILD review", example: "vifm", valueType: "string" },
	{ name: "saveChanges", detail: "Preserve reviewed PKGBUILD edits when supported", valueType: "boolean" },
] as const;

const PARU_EXECUTION_CONSOLE_PARAMS = [
	...PARU_CONFIG_CONSOLE_PARAMS,
	{ name: "noconfirm", detail: "Pass --noconfirm to paru", valueType: "boolean" },
	{ name: "needed", detail: "Pass --needed to paru install/update flows", valueType: "boolean" },
	{ name: "sudo", detail: "Reserved compatibility flag; paru still runs as non-root only", valueType: "boolean" },
] as const;

export const paruConfigGetModule = defineModule<undefined, ParuConfig>({
	id: "paru/config/get",
	category: "paru",
	description: "Get the current session-scoped paru runtime config",
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:paru/config/get");
		return kit.getParuConfig();
	}),
});

export const paruConfigSetModule = defineModule<ParuConfigSetParams, ParuConfig>({
	id: "paru/config/set",
	category: "paru",
	description: "Update the current session-scoped paru runtime config",
	consoleParams: PARU_CONFIG_CONSOLE_PARAMS,
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:paru/config/set");
		return kit.setParuConfig(normalizeParuConfigPatch(context.params));
	}),
});

export const paruInstallModule = defineModule<ParuInstallParams, PackageManagerTransactionResult>({
	id: "paru/install",
	category: "paru",
	description: "Install packages with paru -S",
	consoleParams: [
		{ name: "packages", detail: "Packages to install from repos or AUR", example: "yay,bat", valueType: "string[]", required: true },
		...PARU_EXECUTION_CONSOLE_PARAMS,
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:paru/install");
		const normalized = normalizeInstallParams(context.params);
		return await kit.installAurPackages(normalized.packages, normalized.options);
	}),
}).useDefault("packages");

export const paruRemoveModule = defineModule<ParuRemoveParams, PackageManagerTransactionResult>({
	id: "paru/remove",
	category: "paru",
	description: "Remove packages with paru -R, -Rs, or -Rns",
	consoleParams: [
		{ name: "packages", detail: "Packages to remove", example: "yay", valueType: "string[]", required: true },
		{ name: "recursive", detail: "Use recursive removal semantics", valueType: "boolean" },
		{ name: "purge", detail: "Remove configs and unneeded dependencies too", valueType: "boolean" },
		...PARU_EXECUTION_CONSOLE_PARAMS,
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:paru/remove");
		const normalized = normalizeRemoveParams(context.params);
		return await kit.removeAurPackages(normalized.packages, normalized.options);
	}),
}).useDefault("packages");

export const paruUpdateSystemModule = defineModule<ParuUpdateOptions, PackageManagerTransactionResult>({
	id: "paru/update/system",
	category: "paru",
	description: "Run paru -Syu",
	consoleParams: PARU_EXECUTION_CONSOLE_PARAMS,
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:paru/update/system");
		return await kit.updateSystemWithParu(normalizeExecutionOptions(context.params) as ParuUpdateOptions);
	}),
});

export const paruUpdateAurOnlyModule = defineModule<ParuUpdateOptions, PackageManagerTransactionResult>({
	id: "paru/update/aur-only",
	category: "paru",
	description: "Run paru -Sua",
	consoleParams: PARU_EXECUTION_CONSOLE_PARAMS,
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:paru/update/aur-only");
		return await kit.updateAurOnlyWithParu(normalizeExecutionOptions(context.params) as ParuUpdateOptions);
	}),
});

export const paruAurSearchModule = defineModule<ParuAurSearchParams, AurSearchResult[]>({
	id: "paru/aur/search",
	category: "paru",
	description: "Search the AUR via the RPC API",
	consoleParams: [
		{ name: "query", detail: "Search query", example: "yay", valueType: "string", required: true },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:paru/aur/search");
		return await kit.searchAur(normalizeAurQuery(context.params));
	}),
}).useDefault("query");

export const paruAurInspectModule = defineModule<ParuAurInspectParams, AurInspectResult>({
	id: "paru/aur/inspect",
	category: "paru",
	description: "Fetch AUR metadata and PKGBUILD contents for a package",
	consoleParams: [
		{ name: "packageName", detail: "AUR package name", example: "yay", valueType: "string", required: true },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:paru/aur/inspect");
		return await kit.inspectAur(normalizeAurPackageName(context.params));
	}),
}).useDefault("packageName");

export const paruAurDownloadModule = defineModule<ParuAurDownloadParams, AurDownloadResult>({
	id: "paru/aur/download",
	category: "paru",
	description: "Clone an AUR package repository under data/ for manual review",
	consoleParams: [
		{ name: "packageName", detail: "AUR package name", example: "yay", valueType: "string", required: true },
		{ name: "directory", detail: "Optional target directory relative to data/", example: "/aur/yay", valueType: "string" },
		...PARU_CONFIG_CONSOLE_PARAMS,
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:paru/aur/download");
		return await kit.downloadAur(normalizeAurPackageName(context.params), {
			directory: parseOptionalString(context.params.directory, "directory"),
			executable: parseOptionalString(context.params.executable, "executable"),
		});
	}),
}).useDefault("packageName");