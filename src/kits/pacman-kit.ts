import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { $axios } from "../axios";
import { $manifest } from "../manifest";
import { resolveWritableRuntimePath } from "../runtime-paths";
import { isArchCompatibleDistro, readLinuxDistroInfo, type LinuxDistroInfo } from "../utils/distro-detection";
import { Kit, type KitLifecycleContext } from "./kit";

export const PACMAN_KIT_ID = "pacman";

const DEFAULT_PACMAN_DOWNLOADS_ROOT = resolveWritableRuntimePath("data", "aur");
const GIT_DEPENDENCY_ID = "git";
const PACMAN_DEPENDENCY_ID = "pacman";
const PARU_DEPENDENCY_ID = "paru";
const SUDO_DEPENDENCY_ID = "sudo";

export type PackageManagerRunner = "pacman" | "paru";

export type PackageManagerHostInfo = {
	archCompatible: boolean;
	distro: LinuxDistroInfo;
	gitExecutable: string | null;
	isRoot: boolean;
	originalUser: string | null;
	pacmanExecutable: string | null;
	platform: NodeJS.Platform;
	paruExecutable: string | null;
	sudoExecutable: string | null;
};

export type PacmanConfig = {
	needed: boolean;
	noconfirm: boolean;
	sudo: boolean;
};

export type ParuConfig = {
	executable: string;
	fm: string;
	saveChanges: boolean;
};

export type PackageManagerCommandResult = {
	command: string[];
	commandString: string;
	exitCode: number;
	runner: PackageManagerRunner;
	stderr: string;
	stdout: string;
};

export type PacmanSearchResult = {
	description: string;
	group?: string;
	installed: boolean;
	isOutdated: boolean;
	name: string;
	repo: string;
	version: string;
};

export type PacmanPackageInfo = {
	architecture: string;
	buildDate: number | null;
	dependsOn: string[];
	description: string;
	groups: string[];
	installDate?: number;
	installedSize: number;
	licenses: string[];
	name: string;
	optionalDeps: Record<string, string>;
	packager: string;
	provides: string[];
	reason?: "dependency" | "explicit";
	requiredBy: string[];
	url: string;
	version: string;
};

export type PacmanInstalledPackageSummary = {
	name: string;
	version: string;
};

export type PacmanFileOwner = {
	exists: boolean;
	ownedBy: string | null;
	path: string;
};

export type PacmanCheckResult = PackageManagerCommandResult & {
	issues: string[];
	ok: boolean;
	packages: string[];
};

export type PackageManagerTransactionResult = PackageManagerCommandResult & {
	downloaded: number;
	errors?: string[];
	installed: number;
	packages: {
		installed: string[];
		removed: string[];
		upgraded: string[];
	};
	status: "canceled" | "error" | "success";
};

export type AurSearchResult = PacmanSearchResult & {
	lastModified: number | null;
	maintainer: string | null;
	outOfDate: boolean;
	popularity: number;
	votes: number;
};

export type AurInspectResult = {
	gitUrl: string;
	package: AurSearchResult | null;
	pkgbuild: string | null;
	url: string;
};

export type AurDownloadResult = PackageManagerCommandResult & {
	directory: string;
	package: string;
	pkgbuildPath: string | null;
};

export type PacmanQueryAllOptions = {
	filter?: string;
};

export type PacmanSearchOptions = {
	query?: string;
};

export type PacmanInfoOptions = {
	packageName?: string;
};

export type PacmanFindFileOptions = {
	path?: string;
};

export type PacmanMutationOptions = Partial<PacmanConfig>;

export type PacmanInstallOptions = PacmanMutationOptions;

export type PacmanRemoveOptions = PacmanMutationOptions;

export type PacmanDatabaseCheckOptions = {
	packages?: readonly string[];
};

export type PacmanMarkDepsOptions = PacmanMutationOptions;

export type ParuExecutionOptions = Partial<PacmanConfig> & Partial<ParuConfig>;

export type ParuInstallOptions = ParuExecutionOptions;

export type ParuRemoveOptions = ParuExecutionOptions & {
	purge?: boolean;
	recursive?: boolean;
};

export type ParuUpdateOptions = ParuExecutionOptions;

export type AurDownloadOptions = {
	directory?: string;
	executable?: string;
};

type PacmanRpcResponse<T> = {
	resultcount: number;
	results: T[];
	type: string;
	version: number;
};

type AurRpcSearchEntry = {
	Description?: string;
	ID?: number;
	Maintainer?: string | null;
	Name?: string;
	NumVotes?: number;
	OutOfDate?: number | null;
	PackageBase?: string;
	Popularity?: number;
	URLPath?: string;
	Version?: string;
	LastModified?: number;
};

type MutablePacmanCommandOptions = {
	allowFailure?: boolean;
	configOverrides?: Partial<PacmanConfig>;
	includeNeeded?: boolean;
	includeNoConfirm?: boolean;
	mutating?: boolean;
};

type MutableParuCommandOptions = {
	allowFailure?: boolean;
	configOverrides?: Partial<PacmanConfig> & Partial<ParuConfig>;
	includeNeeded?: boolean;
	includeNoConfirm?: boolean;
};

type DownloadDirectoryResolution = {
	directory: string;
	pkgbuildPath: string;
};

export class PackageManagerCommandError extends Error {
	constructor(public readonly result: PackageManagerCommandResult) {
		super(buildPackageManagerCommandErrorMessage(result));
		this.name = "PackageManagerCommandError";
	}
}

export class PackageManagerUnsupportedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PackageManagerUnsupportedError";
	}
}

export class PackageManagerPrivilegeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PackageManagerPrivilegeError";
	}
}

async function readOutput(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
	if (!stream) {
		return "";
	}

	const output = await new Response(stream).arrayBuffer();
	return Buffer.from(output).toString("utf8").trim();
}

function formatCommand(command: readonly string[]): string {
	return command
		.map((argument) => (/^[A-Za-z0-9_./:=+-]+$/u.test(argument) ? argument : JSON.stringify(argument)))
		.join(" ");
}

function buildPackageManagerCommandErrorMessage(result: PackageManagerCommandResult): string {
	const output = result.stderr || result.stdout || `${result.runner} command failed without output.`;
	return [
		`${result.runner} command failed with exit code ${result.exitCode}.`,
		`Command: ${result.commandString}`,
		output,
	].join("\n");
}

function getOriginalUserName(): string | null {
	const environmentUser = process.env.SUDO_USER?.trim() || process.env.USER?.trim() || "";
	if (environmentUser && environmentUser !== "root") {
		return environmentUser;
	}

	try {
		const username = os.userInfo().username.trim();
		return username && username !== "root" ? username : null;
	} catch {
		return null;
	}
}

function parseHumanSizeToBytes(value: string | undefined): number {
	if (!value) {
		return 0;
	}

	const normalizedValue = value.trim().replace(/^None$/iu, "");
	if (!normalizedValue) {
		return 0;
	}

	const match = normalizedValue.match(/^([0-9][0-9.,]*)\s*(B|bytes|KiB|MiB|GiB|TiB|PiB)?$/iu);
	if (!match?.[1]) {
		return 0;
	}

	const numericValue = Number(match[1].replace(/,/gu, ""));
	if (!Number.isFinite(numericValue)) {
		return 0;
	}

	const unit = (match[2] ?? "B").toLowerCase();
	const multipliers: Record<string, number> = {
		b: 1,
		bytes: 1,
		kib: 1024,
		mib: 1024 ** 2,
		gib: 1024 ** 3,
		tib: 1024 ** 4,
		pib: 1024 ** 5,
	};

	return Math.round(numericValue * (multipliers[unit] ?? 1));
}

function parseDateToTimestamp(value: string | undefined): number | null {
	if (!value || /^None$/iu.test(value.trim())) {
		return null;
	}

	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function parseTokenList(value: string | undefined): string[] {
	if (!value || /^None$/iu.test(value.trim())) {
		return [];
	}

	return value
		.split(/\s+/u)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function parseOptionalDependencies(value: string | undefined): Record<string, string> {
	if (!value || /^None$/iu.test(value.trim())) {
		return {};
	}

	const dependencies: Record<string, string> = {};
	for (const line of value.split(/\r?\n/gu).map((entry) => entry.trim()).filter(Boolean)) {
		const separatorIndex = line.indexOf(":");
		if (separatorIndex < 0) {
			dependencies[line] = "";
			continue;
		}

		const name = line.slice(0, separatorIndex).trim();
		const description = line.slice(separatorIndex + 1).trim();
		if (name) {
			dependencies[name] = description;
		}
	}

	return dependencies;
}

function parsePacmanKeyValueRecord(rawText: string): Record<string, string> {
	const record: Record<string, string> = {};
	let currentKey: string | null = null;

	for (const line of rawText.split(/\r?\n/gu)) {
		if (line.trim().length === 0) {
			currentKey = null;
			continue;
		}

		const entryMatch = line.match(/^([A-Za-z][A-Za-z0-9 ]+?)\s*:\s*(.*)$/u);
		if (entryMatch?.[1] !== undefined && entryMatch[2] !== undefined) {
			currentKey = entryMatch[1].trim();
			record[currentKey] = entryMatch[2].trim();
			continue;
		}

		if (currentKey) {
			record[currentKey] = record[currentKey]
				? `${record[currentKey]}\n${line.trim()}`
				: line.trim();
		}
	}

	return record;
}

function mapPacmanPackageInfo(record: Record<string, string>): PacmanPackageInfo {
	const reasonValue = record["Install Reason"]?.toLowerCase() ?? "";
	const reason = reasonValue.includes("dependency")
		? "dependency"
		: reasonValue.includes("explicit")
			? "explicit"
			: undefined;

	return {
		architecture: record["Architecture"] ?? "",
		buildDate: parseDateToTimestamp(record["Build Date"]),
		dependsOn: parseTokenList(record["Depends On"]),
		description: record["Description"] ?? "",
		groups: parseTokenList(record["Groups"]),
		...(parseDateToTimestamp(record["Install Date"]) !== null
			? { installDate: parseDateToTimestamp(record["Install Date"]) ?? undefined }
			: {}),
		installedSize: parseHumanSizeToBytes(record["Installed Size"]),
		licenses: parseTokenList(record["Licenses"]),
		name: record["Name"] ?? "",
		optionalDeps: parseOptionalDependencies(record["Optional Deps"]),
		packager: record["Packager"] ?? "",
		provides: parseTokenList(record["Provides"]),
		...(reason ? { reason } : {}),
		requiredBy: parseTokenList(record["Required By"]),
		url: record["URL"] ?? "",
		version: record["Version"] ?? "",
	};
}

function parsePacmanInstalledPackageSummaries(rawText: string, filter?: string): PacmanInstalledPackageSummary[] {
	const normalizedFilter = filter?.trim().toLowerCase() ?? "";

	return rawText
		.split(/\r?\n/gu)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const match = line.match(/^(\S+)\s+(\S+)$/u);
			if (!match?.[1] || !match[2]) {
				return null;
			}

			return {
				name: match[1],
				version: match[2],
			};
		})
		.filter((entry): entry is PacmanInstalledPackageSummary => entry !== null)
		.filter((entry) => normalizedFilter.length === 0 || entry.name.toLowerCase().includes(normalizedFilter));
}

function parsePacmanSearchResults(rawText: string): PacmanSearchResult[] {
	const lines = rawText.split(/\r?\n/gu);
	const results: PacmanSearchResult[] = [];

	for (let index = 0; index < lines.length; index += 1) {
		const header = lines[index]?.trimEnd() ?? "";
		if (!header || /^\s/u.test(header)) {
			continue;
		}

		const match = header.match(/^(?<repo>[^/\s]+)\/(?<name>\S+)\s+(?<version>\S+)(?<rest>.*)$/u);
		if (!match?.groups?.repo || !match.groups.name || !match.groups.version) {
			continue;
		}

		const descriptionLines: string[] = [];
		while (index + 1 < lines.length && /^\s/u.test(lines[index + 1] ?? "")) {
			index += 1;
			descriptionLines.push((lines[index] ?? "").trim());
		}

		const rest = match.groups.rest ?? "";
		const installedMatch = rest.match(/\[installed(?::\s*([^\]]+))?\]/u);
		const groupMatch = rest.match(/\(([^)]+)\)/u);
		const installedVersion = installedMatch?.[1]?.trim();

		results.push({
			description: descriptionLines.join(" "),
			...(groupMatch?.[1] ? { group: groupMatch[1].trim() } : {}),
			installed: Boolean(installedMatch),
			isOutdated: Boolean(installedVersion && installedVersion !== match.groups.version),
			name: match.groups.name,
			repo: match.groups.repo,
			version: match.groups.version,
		});
	}

	return results;
}

function parsePackageActionNames(rawText: string, actionNames: readonly string[]): string[] {
	const results: string[] = [];
	const actionPattern = actionNames.map((actionName) => actionName.replace(/[-/\\^$*+?.()|[\]{}]/gu, "\\$&")).join("|");
	const expression = new RegExp(`(?:^|\\n)(?:${actionPattern})\\s+([^\\s.]+)\\.\\.\\.`, "giu");

	for (const match of rawText.matchAll(expression)) {
		const packageName = match[1]?.trim();
		if (packageName) {
			results.push(packageName);
		}
	}

	return [...new Set(results)];
}

function parseTransactionResult(result: PackageManagerCommandResult): PackageManagerTransactionResult {
	const combinedOutput = `${result.stdout}\n${result.stderr}`;
	const downloadedMatch = combinedOutput.match(/Total Download Size\s*:\s*(.+)$/imu);
	const installedMatch = combinedOutput.match(/(?:Total Installed Size|Net Upgrade Size)\s*:\s*(.+)$/imu);
	const errorLines = combinedOutput
		.split(/\r?\n/gu)
		.map((line) => line.trim())
		.filter((line) => /^error:/iu.test(line));

	return {
		...result,
		downloaded: parseHumanSizeToBytes(downloadedMatch?.[1]),
		installed: parseHumanSizeToBytes(installedMatch?.[1]),
		...(errorLines.length > 0 ? { errors: errorLines } : {}),
		packages: {
			installed: parsePackageActionNames(combinedOutput, ["installing", "reinstalling"]),
			removed: parsePackageActionNames(combinedOutput, ["removing"]),
			upgraded: parsePackageActionNames(combinedOutput, ["upgrading"]),
		},
		status: /cancel/iu.test(combinedOutput) ? "canceled" : result.exitCode === 0 ? "success" : "error",
	};
}

function parseCheckResult(result: PackageManagerCommandResult): PacmanCheckResult {
	const issues = `${result.stdout}\n${result.stderr}`
		.split(/\r?\n/gu)
		.map((line) => line.trim())
		.filter((line) => /warning:/iu.test(line));
	const packageNames = [...new Set(
		`${result.stdout}\n${result.stderr}`
			.split(/\r?\n/gu)
			.map((line) => line.match(/warning:\s*([^:]+):/iu)?.[1]?.trim() ?? line.match(/^([^:]+):\s+/u)?.[1]?.trim() ?? null)
			.filter((value): value is string => Boolean(value)),
	)];

	return {
		...result,
		issues,
		ok: issues.length === 0 && result.exitCode === 0,
		packages: packageNames,
	};
}

function resolveAurGitUrl(packageName: string): string {
	return `https://aur.archlinux.org/${encodeURIComponent(packageName)}.git`;
}

function resolveAurPkgbuildUrl(packageName: string): string {
	return `https://aur.archlinux.org/cgit/aur.git/plain/PKGBUILD?h=${encodeURIComponent(packageName)}`;
}

function resolveAvailableManifestDependencyCommand(dependencyId: string): string | null {
	const dependency = $manifest.refreshDependency(dependencyId);
	if (!dependency.available) {
		return null;
	}

	return dependency.resolvedPath ?? dependency.resolvedBinary ?? dependency.binary;
}

export class PacmanKit extends Kit {
	private readonly dataRoot: string;
	private hostInfo: PackageManagerHostInfo = {
		archCompatible: false,
		distro: {
			id: null,
			idLike: [],
			name: null,
			prettyName: null,
			versionId: null,
		},
		gitExecutable: null,
		isRoot: false,
		originalUser: null,
		pacmanExecutable: null,
		platform: process.platform,
		paruExecutable: null,
		sudoExecutable: null,
	};
	private pacmanConfig: PacmanConfig = {
		needed: true,
		noconfirm: true,
		sudo: true,
	};
	private paruConfig: ParuConfig = {
		executable: $manifest.requireDependency(PARU_DEPENDENCY_ID).binary,
		fm: "vifm",
		saveChanges: true,
	};

	constructor(options: { dataRoot?: string } = {}) {
		super({
			id: PACMAN_KIT_ID,
			name: "Pacman Kit",
			description: "Run Arch Linux package-manager operations through pacman and paru",
		});
		this.dataRoot = path.resolve(options.dataRoot ?? resolveWritableRuntimePath("data"));
	}

	protected override async onStart(_context: KitLifecycleContext): Promise<void> {
		await fs.mkdir(this.dataRoot, { recursive: true });
		this.hostInfo = await this.detectHostInfo();
	}

	async getHostInfo(): Promise<PackageManagerHostInfo> {
		return structuredClone(this.hostInfo);
	}

	getPacmanConfig(): PacmanConfig {
		return { ...this.pacmanConfig };
	}

	setPacmanConfig(nextConfig: Partial<PacmanConfig>): PacmanConfig {
		if (typeof nextConfig.sudo === "boolean") {
			this.pacmanConfig.sudo = nextConfig.sudo;
		}
		if (typeof nextConfig.noconfirm === "boolean") {
			this.pacmanConfig.noconfirm = nextConfig.noconfirm;
		}
		if (typeof nextConfig.needed === "boolean") {
			this.pacmanConfig.needed = nextConfig.needed;
		}

		return this.getPacmanConfig();
	}

	getParuConfig(): ParuConfig {
		return { ...this.paruConfig };
	}

	setParuConfig(nextConfig: Partial<ParuConfig>): ParuConfig {
		if (typeof nextConfig.executable === "string" && nextConfig.executable.trim().length > 0) {
			this.paruConfig.executable = nextConfig.executable.trim();
		}
		if (typeof nextConfig.fm === "string" && nextConfig.fm.trim().length > 0) {
			this.paruConfig.fm = nextConfig.fm.trim();
		}
		if (typeof nextConfig.saveChanges === "boolean") {
			this.paruConfig.saveChanges = nextConfig.saveChanges;
		}

		return this.getParuConfig();
	}

	async listInstalledPackages(options: PacmanQueryAllOptions = {}): Promise<PacmanInstalledPackageSummary[]> {
		const result = await this.runPacman(["-Q"], { allowFailure: false });
		return parsePacmanInstalledPackageSummaries(result.stdout, options.filter);
	}

	async listOrphans(): Promise<PacmanInstalledPackageSummary[]> {
		const result = await this.runPacman(["-Qdt"], { allowFailure: true });
		if (result.exitCode !== 0 && result.stdout.length === 0) {
			return [];
		}

		return parsePacmanInstalledPackageSummaries(result.stdout);
	}

	async searchPackages(query: string): Promise<PacmanSearchResult[]> {
		const result = await this.runPacman(["-Ss", query], { allowFailure: false });
		return parsePacmanSearchResults(result.stdout);
	}

	async getPackageInfo(packageName: string): Promise<PacmanPackageInfo> {
		const installedResult = await this.runPacman(["-Qi", packageName], { allowFailure: true });
		if (installedResult.exitCode === 0) {
			return mapPacmanPackageInfo(parsePacmanKeyValueRecord(installedResult.stdout));
		}

		const syncResult = await this.runPacman(["-Si", packageName], { allowFailure: false });
		return mapPacmanPackageInfo(parsePacmanKeyValueRecord(syncResult.stdout));
	}

	async findFileOwner(filePath: string): Promise<PacmanFileOwner> {
		const resolvedPath = path.resolve(filePath);
		const exists = await fs.stat(resolvedPath).then(() => true).catch(() => false);
		if (!exists) {
			return {
				exists: false,
				ownedBy: null,
				path: resolvedPath,
			};
		}

		const result = await this.runPacman(["-Qo", resolvedPath], { allowFailure: true });
		if (result.exitCode !== 0) {
			return {
				exists: true,
				ownedBy: null,
				path: resolvedPath,
			};
		}

		const match = result.stdout.match(/\sowned by\s+(\S+)\s+/iu);
		return {
			exists: true,
			ownedBy: match?.[1] ?? null,
			path: resolvedPath,
		};
	}

	async installPackages(packages: readonly string[], options: PacmanInstallOptions = {}): Promise<PackageManagerTransactionResult> {
		const result = await this.runPacman(["-S", ...packages], {
			configOverrides: options,
			includeNeeded: true,
			includeNoConfirm: true,
			mutating: true,
		});
		return parseTransactionResult(result);
	}

	async syncDatabases(options: PacmanMutationOptions = {}): Promise<PackageManagerTransactionResult> {
		const result = await this.runPacman(["-Sy"], {
			configOverrides: options,
			includeNoConfirm: true,
			mutating: true,
		});
		return parseTransactionResult(result);
	}

	async fullUpgrade(options: PacmanMutationOptions = {}): Promise<PackageManagerTransactionResult> {
		const result = await this.runPacman(["-Syu"], {
			configOverrides: options,
			includeNeeded: true,
			includeNoConfirm: true,
			mutating: true,
		});
		return parseTransactionResult(result);
	}

	async removePackages(mode: "purge" | "recursive" | "soft", packages: readonly string[], options: PacmanRemoveOptions = {}): Promise<PackageManagerTransactionResult> {
		const flag = mode === "purge" ? "-Rns" : mode === "recursive" ? "-Rs" : "-R";
		const result = await this.runPacman([flag, ...packages], {
			configOverrides: options,
			includeNoConfirm: true,
			mutating: true,
		});
		return parseTransactionResult(result);
	}

	async markDependencies(packages: readonly string[], options: PacmanMarkDepsOptions = {}): Promise<PackageManagerTransactionResult> {
		const result = await this.runPacman(["-D", "--asdeps", ...packages], {
			configOverrides: options,
			includeNoConfirm: true,
			mutating: true,
		});
		return parseTransactionResult(result);
	}

	async checkPackages(options: PacmanDatabaseCheckOptions = {}): Promise<PacmanCheckResult> {
		const result = await this.runPacman(["-Qk", ...(options.packages ?? [])], { allowFailure: true });
		return parseCheckResult(result);
	}

	async cleanCache(options: PacmanMutationOptions = {}): Promise<PackageManagerTransactionResult> {
		const result = await this.runPacman(["-Sc"], {
			configOverrides: options,
			includeNoConfirm: true,
			mutating: true,
		});
		return parseTransactionResult(result);
	}

	async installAurPackages(packages: readonly string[], options: ParuInstallOptions = {}): Promise<PackageManagerTransactionResult> {
		const result = await this.runParu(["-S", ...packages], {
			configOverrides: options,
			includeNeeded: true,
			includeNoConfirm: true,
		});
		return parseTransactionResult(result);
	}

	async removeAurPackages(packages: readonly string[], options: ParuRemoveOptions = {}): Promise<PackageManagerTransactionResult> {
		const removalFlag = options.purge ? "-Rns" : options.recursive ? "-Rs" : "-R";
		const result = await this.runParu([removalFlag, ...packages], {
			configOverrides: options,
			includeNoConfirm: true,
		});
		return parseTransactionResult(result);
	}

	async updateSystemWithParu(options: ParuUpdateOptions = {}): Promise<PackageManagerTransactionResult> {
		const result = await this.runParu(["-Syu"], {
			configOverrides: options,
			includeNeeded: true,
			includeNoConfirm: true,
		});
		return parseTransactionResult(result);
	}

	async updateAurOnlyWithParu(options: ParuUpdateOptions = {}): Promise<PackageManagerTransactionResult> {
		const result = await this.runParu(["-Sua"], {
			configOverrides: options,
			includeNoConfirm: true,
		});
		return parseTransactionResult(result);
	}

	async searchAur(query: string): Promise<AurSearchResult[]> {
		this.assertArchCompatible("paru");

		const response = await $axios.get<PacmanRpcResponse<AurRpcSearchEntry>>(
			`https://aur.archlinux.org/rpc/v5/search/${encodeURIComponent(query)}`,
			{ params: { by: "name-desc" } },
		);

		const installedVersions = this.hostInfo.pacmanExecutable
			? new Map((await this.listInstalledPackages()).map((entry) => [entry.name, entry.version] as const))
			: new Map<string, string>();

		return (response.data.results ?? []).map((entry) => this.mapAurEntry(entry, installedVersions.get(entry.Name ?? "") ?? null));
	}

	async inspectAur(packageName: string): Promise<AurInspectResult> {
		this.assertArchCompatible("paru");

		const [rpcResponse, pkgbuildResponse] = await Promise.all([
			$axios.get<PacmanRpcResponse<AurRpcSearchEntry>>("https://aur.archlinux.org/rpc/v5/info", {
				params: { "arg[]": packageName },
			}),
			$axios.get<string>(resolveAurPkgbuildUrl(packageName), { responseType: "text" }),
		]);

		const installedVersion = this.hostInfo.pacmanExecutable
			? await this.lookupInstalledPackageVersion(packageName)
			: null;
		const entry = rpcResponse.data.results?.[0] ?? null;

		return {
			gitUrl: resolveAurGitUrl(packageName),
			package: entry ? this.mapAurEntry(entry, installedVersion) : null,
			pkgbuild: typeof pkgbuildResponse.data === "string" ? pkgbuildResponse.data : null,
			url: `https://aur.archlinux.org/packages/${encodeURIComponent(packageName)}`,
		};
	}

	async downloadAur(packageName: string, options: AurDownloadOptions = {}): Promise<AurDownloadResult> {
		await this.assertParuCliSupported(options.executable);
		const gitExecutable = this.assertGitSupported();
		const target = await this.resolveDownloadDirectory(packageName, options.directory);
		await fs.rm(target.directory, { recursive: true, force: true });
		await fs.mkdir(path.dirname(target.directory), { recursive: true });

		const result = await this.runRawCommand(
			[
				gitExecutable,
				"clone",
				resolveAurGitUrl(packageName),
				target.directory,
			],
			{ runner: "paru" },
		);

		return {
			...result,
			directory: target.directory,
			package: packageName,
			pkgbuildPath: target.pkgbuildPath,
		};
	}

	private async detectHostInfo(): Promise<PackageManagerHostInfo> {
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
			distro,
			gitExecutable: resolveAvailableManifestDependencyCommand(GIT_DEPENDENCY_ID),
			isRoot: typeof process.getuid === "function" ? process.getuid() === 0 : false,
			originalUser: getOriginalUserName(),
			pacmanExecutable: resolveAvailableManifestDependencyCommand(PACMAN_DEPENDENCY_ID),
			platform: process.platform,
			paruExecutable: resolveAvailableManifestDependencyCommand(PARU_DEPENDENCY_ID),
			sudoExecutable: resolveAvailableManifestDependencyCommand(SUDO_DEPENDENCY_ID),
		};
	}

	private assertArchCompatible(namespace: PackageManagerRunner): void {
		if (this.hostInfo.archCompatible) {
			return;
		}

		const detectedDistro = this.hostInfo.distro.id ?? this.hostInfo.distro.prettyName ?? this.hostInfo.platform;
		throw new PackageManagerUnsupportedError(
			`${namespace} is only supported on Arch Linux hosts; detected ${detectedDistro}.`,
		);
	}

	private async assertParuCliSupported(executableOverride?: string): Promise<string> {
		this.assertArchCompatible("paru");

		const executable = executableOverride?.trim() || this.paruConfig.executable;
		const manifestParuBinary = $manifest.requireDependency(PARU_DEPENDENCY_ID).binary;
		const resolvedExecutable = executable === manifestParuBinary
			? this.hostInfo.paruExecutable
			: Bun.which(executable) ?? null;
		if (!resolvedExecutable) {
			throw new PackageManagerUnsupportedError(
				`paru executable '${executable}' was not found on this host. Update manifest.dependencies.paru.binary or install the binary in PATH.`,
			);
		}

		if (this.hostInfo.isRoot && !this.hostInfo.originalUser) {
			throw new PackageManagerPrivilegeError("paru requires a non-root user, and no original user could be determined.");
		}

		return resolvedExecutable;
	}

	private assertPacmanSupported(): string {
		this.assertArchCompatible("pacman");
		if (!this.hostInfo.pacmanExecutable) {
			throw new PackageManagerUnsupportedError(
				"pacman executable was not found on this host. Update manifest.dependencies.pacman.binary or install the binary in PATH.",
			);
		}

		return this.hostInfo.pacmanExecutable;
	}

	private assertGitSupported(): string {
		if (!this.hostInfo.gitExecutable) {
			throw new PackageManagerUnsupportedError(
				"git executable was not found on this host. Update manifest.dependencies.git.binary or install the binary in PATH.",
			);
		}

		return this.hostInfo.gitExecutable;
	}

	private assertSudoSupported(): string {
		if (!this.hostInfo.sudoExecutable) {
			throw new PackageManagerPrivilegeError(
				"sudo is required for this pacman operation but is not available. Update manifest.dependencies.sudo.binary or install sudo in PATH.",
			);
		}

		return this.hostInfo.sudoExecutable;
	}

	private resolvePacmanConfig(overrides: Partial<PacmanConfig> | undefined): PacmanConfig {
		return {
			needed: overrides?.needed ?? this.pacmanConfig.needed,
			noconfirm: overrides?.noconfirm ?? this.pacmanConfig.noconfirm,
			sudo: overrides?.sudo ?? this.pacmanConfig.sudo,
		};
	}

	private resolveParuConfig(overrides: Partial<ParuConfig> | undefined): ParuConfig {
		return {
			executable: overrides?.executable?.trim() || this.paruConfig.executable,
			fm: overrides?.fm?.trim() || this.paruConfig.fm,
			saveChanges: overrides?.saveChanges ?? this.paruConfig.saveChanges,
		};
	}

	private async runPacman(args: readonly string[], options: MutablePacmanCommandOptions): Promise<PackageManagerCommandResult> {
		const pacmanExecutable = this.assertPacmanSupported();
		const effectiveConfig = this.resolvePacmanConfig(options.configOverrides);
		const command: string[] = [];

		if (options.mutating) {
			if (this.hostInfo.isRoot) {
				// Already elevated.
			} else if (effectiveConfig.sudo) {
				command.push(this.assertSudoSupported(), "-n");
			} else {
				throw new PackageManagerPrivilegeError("Mutating pacman commands require root privileges or sudo=true.");
			}
		}

		command.push(pacmanExecutable);
		if (options.includeNoConfirm && effectiveConfig.noconfirm) {
			command.push("--noconfirm");
		}
		if (options.includeNeeded && effectiveConfig.needed) {
			command.push("--needed");
		}
		command.push(...args);

		return await this.runRawCommand(command, {
			allowFailure: options.allowFailure,
			runner: "pacman",
		});
	}

	private async runParu(args: readonly string[], options: MutableParuCommandOptions): Promise<PackageManagerCommandResult> {
		const effectivePacmanConfig = this.resolvePacmanConfig(options.configOverrides);
		const effectiveParuConfig = this.resolveParuConfig(options.configOverrides);
		const paruExecutable = await this.assertParuCliSupported(effectiveParuConfig.executable);
		const command: string[] = [];

		if (this.hostInfo.isRoot) {
			if (!this.hostInfo.originalUser) {
				throw new PackageManagerPrivilegeError("paru requires a non-root user and non-interactive sudo access.");
			}
			command.push(this.assertSudoSupported(), "-n", "-u", this.hostInfo.originalUser);
		}

		command.push(paruExecutable);
		if (options.includeNoConfirm && effectivePacmanConfig.noconfirm) {
			command.push("--noconfirm");
		}
		if (options.includeNeeded && effectivePacmanConfig.needed) {
			command.push("--needed");
		}
		command.push(...args);

		return await this.runRawCommand(command, {
			allowFailure: options.allowFailure,
			runner: "paru",
		});
	}

	private async runRawCommand(
		command: readonly string[],
		options: { allowFailure?: boolean; cwd?: string; runner: PackageManagerRunner },
	): Promise<PackageManagerCommandResult> {
		const child = Bun.spawn({
			cmd: [...command],
			cwd: options.cwd ?? process.cwd(),
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});

		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			readOutput(child.stdout),
			readOutput(child.stderr),
		]);

		const result: PackageManagerCommandResult = {
			command: [...command],
			commandString: formatCommand(command),
			exitCode,
			runner: options.runner,
			stderr,
			stdout,
		};

		if (exitCode !== 0 && !options.allowFailure) {
			throw new PackageManagerCommandError(result);
		}

		return result;
	}

	private async lookupInstalledPackageVersion(packageName: string): Promise<string | null> {
		if (!this.hostInfo.pacmanExecutable) {
			return null;
		}

		const result = await this.runPacman(["-Q", packageName], { allowFailure: true });
		if (result.exitCode !== 0) {
			return null;
		}

		const match = result.stdout.match(/^\S+\s+(\S+)$/mu);
		return match?.[1] ?? null;
	}

	private mapAurEntry(entry: AurRpcSearchEntry, installedVersion: string | null): AurSearchResult {
		const version = entry.Version?.trim() ?? "";
		return {
			description: entry.Description?.trim() ?? "",
			installed: Boolean(installedVersion),
			isOutdated: Boolean(installedVersion && installedVersion !== version),
			lastModified: typeof entry.LastModified === "number" ? entry.LastModified : null,
			maintainer: entry.Maintainer ?? null,
			name: entry.Name?.trim() ?? "",
			outOfDate: entry.OutOfDate !== null && entry.OutOfDate !== undefined,
			popularity: typeof entry.Popularity === "number" ? entry.Popularity : 0,
			repo: "aur",
			version,
			votes: typeof entry.NumVotes === "number" ? entry.NumVotes : 0,
		};
	}

	private async resolveDownloadDirectory(packageName: string, targetPath?: string): Promise<DownloadDirectoryResolution> {
		const relativePath = targetPath?.trim()
			? targetPath.trim().replace(/^\/+/, "")
			: path.posix.join("aur", packageName);
		const directory = path.resolve(this.dataRoot, relativePath);
		this.assertWithinDataRoot(directory);
		await this.assertCreatablePathWithinDataRoot(directory);
		return {
			directory,
			pkgbuildPath: path.join(directory, "PKGBUILD"),
		};
	}

	private assertWithinDataRoot(candidatePath: string): void {
		const normalizedRoot = this.dataRoot.endsWith(path.sep) ? this.dataRoot : `${this.dataRoot}${path.sep}`;
		if (candidatePath === this.dataRoot || candidatePath.startsWith(normalizedRoot)) {
			return;
		}

		throw new Error(`Path escapes the package-manager data root: ${candidatePath}`);
	}

	private async assertCreatablePathWithinDataRoot(candidatePath: string): Promise<void> {
		let currentPath = candidatePath;
		while (true) {
			try {
				const resolvedPath = await fs.realpath(currentPath);
				this.assertWithinDataRoot(resolvedPath);
				return;
			} catch (error) {
				if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
					throw error;
				}
			}

			const parentPath = path.dirname(currentPath);
			if (parentPath === currentPath) {
				return;
			}
			currentPath = parentPath;
		}
	}
}