import {
	PACMAN_KIT_ID,
	PacmanKit,
	type PackageManagerHostInfo,
	type PackageManagerTransactionResult,
	type PacmanCheckResult,
	type PacmanConfig,
	type PacmanDatabaseCheckOptions,
	type PacmanFileOwner,
	type PacmanFindFileOptions,
	type PacmanInfoOptions,
	type PacmanInstalledPackageSummary,
	type PacmanInstallOptions,
	type PacmanMarkDepsOptions,
	type PacmanMutationOptions,
	type PacmanPackageInfo,
	type PacmanQueryAllOptions,
	type PacmanRemoveOptions,
	type PacmanSearchOptions,
	type PacmanSearchResult,
} from "../kits";
import { InvalidParamsError } from "./errors";
import { defineExecutor, defineModule, type ModuleExecutionContext } from "./module";

type EnsurePacmanKitContext = Pick<ModuleExecutionContext<unknown, object>, "getKit" | "runtime">;

type PacmanConfigSetParams = Partial<PacmanConfig>;

export type PacmanInstallParams = Omit<PacmanInstallOptions, never> & {
	packages?: readonly string[] | string;
};

export type PacmanListParams = PacmanQueryAllOptions;

export type PacmanSearchParams = PacmanSearchOptions & {
	query?: string;
};

export type PacmanInfoParams = PacmanInfoOptions & {
	packageName?: string;
	pkg?: string;
};

export type PacmanFindFileParams = PacmanFindFileOptions;

export type PacmanRemoveParams = Omit<PacmanRemoveOptions, never> & {
	packages?: readonly string[] | string;
};

export type PacmanMarkDepsParams = Omit<PacmanMarkDepsOptions, never> & {
	packages?: readonly string[] | string;
};

export type PacmanCheckParams = Omit<PacmanDatabaseCheckOptions, "packages"> & {
	packages?: readonly string[] | string;
};

async function ensurePacmanKit(
	context: EnsurePacmanKitContext,
	reason = "module:pacman",
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

function normalizePacmanConfigPatch(params: PacmanConfigSetParams): Partial<PacmanConfig> {
	return {
		...(params.sudo !== undefined ? { sudo: parseOptionalBoolean(params.sudo, "sudo") } : {}),
		...(params.noconfirm !== undefined ? { noconfirm: parseOptionalBoolean(params.noconfirm, "noconfirm") } : {}),
		...(params.needed !== undefined ? { needed: parseOptionalBoolean(params.needed, "needed") } : {}),
		// Values above are booleans or undefined by construction.
	} as Partial<PacmanConfig>;
}

function normalizeMutationOptions<T extends { needed?: unknown; noconfirm?: unknown; sudo?: unknown }>(params: T): PacmanMutationOptions {
	return {
		needed: parseOptionalBoolean(params.needed, "needed"),
		noconfirm: parseOptionalBoolean(params.noconfirm, "noconfirm"),
		sudo: parseOptionalBoolean(params.sudo, "sudo"),
	};
}

function normalizeInstallParams(params: PacmanInstallParams): { options: PacmanInstallOptions; packages: readonly string[] } {
	return {
		options: normalizeMutationOptions(params),
		packages: parseRequiredStringArray(params.packages, "packages"),
	};
}

function normalizeRemoveParams(params: PacmanRemoveParams): { options: PacmanRemoveOptions; packages: readonly string[] } {
	return {
		options: normalizeMutationOptions(params),
		packages: parseRequiredStringArray(params.packages, "packages"),
	};
}

function normalizeMarkDepsParams(params: PacmanMarkDepsParams): { options: PacmanMarkDepsOptions; packages: readonly string[] } {
	return {
		options: normalizeMutationOptions(params),
		packages: parseRequiredStringArray(params.packages, "packages"),
	};
}

function normalizeListParams(params: PacmanListParams): PacmanQueryAllOptions {
	return {
		filter: parseOptionalString(params.filter, "filter"),
	};
}

function normalizeSearchParams(params: PacmanSearchParams): string {
	return parseRequiredString(params.query, "query");
}

function normalizeInfoParams(params: PacmanInfoParams): string {
	return parseRequiredString(params.packageName ?? params.pkg, "packageName");
}

function normalizeFindFileParams(params: PacmanFindFileParams): string {
	return parseRequiredString(params.path, "path");
}

function normalizeCheckParams(params: PacmanCheckParams): PacmanDatabaseCheckOptions {
	return {
		packages: parseOptionalStringArray(params.packages, "packages"),
	};
}

const PACMAN_CONFIG_CONSOLE_PARAMS = [
	{ name: "sudo", detail: "Use sudo -n for mutating pacman operations", valueType: "boolean" },
	{ name: "noconfirm", detail: "Pass --noconfirm by default for mutating transactions", valueType: "boolean" },
	{ name: "needed", detail: "Pass --needed by default for install-style transactions", valueType: "boolean" },
] as const;

const PACMAN_MUTATION_CONSOLE_PARAMS = [
	...PACMAN_CONFIG_CONSOLE_PARAMS,
] as const;

export const pacmanConfigGetModule = defineModule<undefined, PacmanConfig>({
	id: "pacman/config/get",
	category: "pacman",
	description: "Get the current session-scoped pacman runtime config",
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/config/get");
		return kit.getPacmanConfig();
	}),
});

export const pacmanConfigSetModule = defineModule<PacmanConfigSetParams, PacmanConfig>({
	id: "pacman/config/set",
	category: "pacman",
	description: "Update the current session-scoped pacman runtime config",
	consoleParams: PACMAN_CONFIG_CONSOLE_PARAMS,
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/config/set");
		return kit.setPacmanConfig(normalizePacmanConfigPatch(context.params));
	}),
});

export const pacmanInstallModule = defineModule<PacmanInstallParams, PackageManagerTransactionResult>({
	id: "pacman/install",
	category: "pacman",
	description: "Install packages with pacman -S",
	consoleParams: [
		{ name: "packages", detail: "Packages to install", example: "git,bash", valueType: "string[]", required: true },
		...PACMAN_MUTATION_CONSOLE_PARAMS,
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/install");
		const normalized = normalizeInstallParams(context.params);
		return await kit.installPackages(normalized.packages, normalized.options);
	}),
}).useDefault("packages");

export const pacmanListModule = defineModule<PacmanListParams, PacmanInstalledPackageSummary[]>({
	id: "pacman/list",
	category: "pacman",
	description: "List installed packages with pacman -Q",
	consoleParams: [
		{ name: "filter", detail: "Optional client-side name filter", example: "bash", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/list");
		return await kit.listInstalledPackages(normalizeListParams(context.params));
	}),
});

export const pacmanSearchModule = defineModule<PacmanSearchParams, PacmanSearchResult[]>({
	id: "pacman/search",
	category: "pacman",
	description: "Search sync repositories with pacman -Ss",
	consoleParams: [
		{ name: "query", detail: "Search query", example: "vlc", valueType: "string", required: true },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/search");
		return await kit.searchPackages(normalizeSearchParams(context.params));
	}),
}).useDefault("query");

export const pacmanInfoModule = defineModule<PacmanInfoParams, PacmanPackageInfo>({
	id: "pacman/info",
	category: "pacman",
	description: "Show package info with pacman -Qi or pacman -Si",
	consoleParams: [
		{ name: "packageName", detail: "Package name", example: "bash", valueType: "string", required: true },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/info");
		return await kit.getPackageInfo(normalizeInfoParams(context.params));
	}),
}).useDefault("packageName");

export const pacmanSyncModule = defineModule<PacmanMutationOptions, PackageManagerTransactionResult>({
	id: "pacman/sync",
	category: "pacman",
	description: "Run pacman -Syu",
	consoleParams: PACMAN_MUTATION_CONSOLE_PARAMS,
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/sync");
		return await kit.fullUpgrade(normalizeMutationOptions(context.params));
	}),
});

export const pacmanRemoveModule = defineModule<PacmanRemoveParams, PackageManagerTransactionResult>({
	id: "pacman/remove",
	category: "pacman",
	description: "Remove packages with pacman -Rs",
	consoleParams: [
		{ name: "packages", detail: "Packages to remove", example: "vlc", valueType: "string[]", required: true },
		...PACMAN_MUTATION_CONSOLE_PARAMS,
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/remove");
		const normalized = normalizeRemoveParams(context.params);
		return await kit.removePackages("recursive", normalized.packages, normalized.options);
	}),
}).useDefault("packages");

export const pacmanCleanModule = defineModule<PacmanMutationOptions, PackageManagerTransactionResult>({
	id: "pacman/clean",
	category: "pacman",
	description: "Clean the pacman cache with pacman -Sc",
	consoleParams: PACMAN_MUTATION_CONSOLE_PARAMS,
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/clean");
		return await kit.cleanCache(normalizeMutationOptions(context.params));
	}),
});

export const pacmanSyncInstallModule = defineModule<PacmanInstallParams, PackageManagerTransactionResult>({
	id: "pacman/sync/install",
	category: "pacman",
	description: "Run pacman -S",
	consoleParams: pacmanInstallModule.consoleParams,
	executor: pacmanInstallModule.executor,
}).useDefault("packages");

export const pacmanSyncUpdateModule = defineModule<PacmanMutationOptions, PackageManagerTransactionResult>({
	id: "pacman/sync/update",
	category: "pacman",
	description: "Refresh package databases with pacman -Sy",
	consoleParams: PACMAN_MUTATION_CONSOLE_PARAMS,
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/sync/update");
		return await kit.syncDatabases(normalizeMutationOptions(context.params));
	}),
});

export const pacmanSyncFullUpgradeModule = defineModule<PacmanMutationOptions, PackageManagerTransactionResult>({
	id: "pacman/sync/full-upgrade",
	category: "pacman",
	description: "Run pacman -Syu",
	consoleParams: PACMAN_MUTATION_CONSOLE_PARAMS,
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/sync/full-upgrade");
		return await kit.fullUpgrade(normalizeMutationOptions(context.params));
	}),
});

export const pacmanSyncSearchModule = defineModule<PacmanSearchParams, PacmanSearchResult[]>({
	id: "pacman/sync/search",
	category: "pacman",
	description: "Run pacman -Ss",
	consoleParams: pacmanSearchModule.consoleParams,
	executor: pacmanSearchModule.executor,
}).useDefault("query");

export const pacmanQueryAllModule = defineModule<PacmanListParams, PacmanInstalledPackageSummary[]>({
	id: "pacman/query/all",
	category: "pacman",
	description: "Run pacman -Q",
	consoleParams: pacmanListModule.consoleParams,
	executor: pacmanListModule.executor,
});

export const pacmanQueryInfoModule = defineModule<PacmanInfoParams, PacmanPackageInfo>({
	id: "pacman/query/info",
	category: "pacman",
	description: "Run pacman -Qi or pacman -Si",
	consoleParams: pacmanInfoModule.consoleParams,
	executor: pacmanInfoModule.executor,
}).useDefault("packageName");

export const pacmanQueryFindFileModule = defineModule<PacmanFindFileParams, PacmanFileOwner>({
	id: "pacman/query/find-file",
	category: "pacman",
	description: "Find which package owns a file path",
	consoleParams: [
		{ name: "path", detail: "Absolute or relative filesystem path", example: "/usr/bin/bash", valueType: "string", required: true },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/query/find-file");
		return await kit.findFileOwner(normalizeFindFileParams(context.params));
	}),
}).useDefault("path");

export const pacmanQueryOrphansModule = defineModule<undefined, PacmanInstalledPackageSummary[]>({
	id: "pacman/query/orphans",
	category: "pacman",
	description: "List orphaned packages with pacman -Qdt",
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/query/orphans");
		return await kit.listOrphans();
	}),
});

export const pacmanRemoveSoftModule = defineModule<PacmanRemoveParams, PackageManagerTransactionResult>({
	id: "pacman/remove/soft",
	category: "pacman",
	description: "Run pacman -R",
	consoleParams: pacmanRemoveModule.consoleParams,
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/remove/soft");
		const normalized = normalizeRemoveParams(context.params);
		return await kit.removePackages("soft", normalized.packages, normalized.options);
	}),
}).useDefault("packages");

export const pacmanRemoveRecursiveModule = defineModule<PacmanRemoveParams, PackageManagerTransactionResult>({
	id: "pacman/remove/recursive",
	category: "pacman",
	description: "Run pacman -Rs",
	consoleParams: pacmanRemoveModule.consoleParams,
	executor: pacmanRemoveModule.executor,
}).useDefault("packages");

export const pacmanRemovePurgeModule = defineModule<PacmanRemoveParams, PackageManagerTransactionResult>({
	id: "pacman/remove/purge",
	category: "pacman",
	description: "Run pacman -Rns",
	consoleParams: pacmanRemoveModule.consoleParams,
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/remove/purge");
		const normalized = normalizeRemoveParams(context.params);
		return await kit.removePackages("purge", normalized.packages, normalized.options);
	}),
}).useDefault("packages");

export const pacmanDatabaseMarkDepsModule = defineModule<PacmanMarkDepsParams, PackageManagerTransactionResult>({
	id: "pacman/database/mark-deps",
	category: "pacman",
	description: "Mark packages as dependencies with pacman -D --asdeps",
	consoleParams: [
		{ name: "packages", detail: "Packages to mark as dependencies", example: "foo,bar", valueType: "string[]", required: true },
		...PACMAN_MUTATION_CONSOLE_PARAMS,
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/database/mark-deps");
		const normalized = normalizeMarkDepsParams(context.params);
		return await kit.markDependencies(normalized.packages, normalized.options);
	}),
}).useDefault("packages");

export const pacmanDatabaseCheckModule = defineModule<PacmanCheckParams, PacmanCheckResult>({
	id: "pacman/database/check",
	category: "pacman",
	description: "Check package files with pacman -Qk",
	consoleParams: [
		{ name: "packages", detail: "Optional packages to check; checks all when omitted", example: "bash,glibc", valueType: "string[]" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensurePacmanKit(context, "module:pacman/database/check");
		return await kit.checkPackages(normalizeCheckParams(context.params));
	}),
});

export const pacmanDatabaseCleanModule = defineModule<PacmanMutationOptions, PackageManagerTransactionResult>({
	id: "pacman/database/clean",
	category: "pacman",
	description: "Clean the package cache with pacman -Sc",
	consoleParams: PACMAN_MUTATION_CONSOLE_PARAMS,
	executor: pacmanCleanModule.executor,
});