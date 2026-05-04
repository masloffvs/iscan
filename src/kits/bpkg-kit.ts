import fs from "node:fs/promises";
import path from "node:path";

import {
	getBpkgBindingDefinition,
	getRegisteredBpkgPackage,
	listRegisteredBpkgPackages,
	normalizeBpkgBindingParams,
	type BpkgSupportedPackageSummary,
	type BpkgTranspiledCommand,
} from "../bpkg";
import { $manifest } from "../manifest";
import { resolveWritableRuntimePath } from "../runtime-paths";
import { isArchCompatibleDistro, readLinuxDistroInfo, type LinuxDistroInfo } from "../utils/distro-detection";
import { Kit, type KitLifecycleContext } from "./kit";

export const BPKG_KIT_ID = "bpkg";

const BWRAP_DEPENDENCY_ID = "bwrap";
const PACSTRAP_DEPENDENCY_ID = "pacstrap";
const SUDO_DEPENDENCY_ID = "sudo";

export type BpkgBoxStatus = "missing" | "building" | "ready" | "error";

export type BpkgHostInfo = {
	archCompatible: boolean;
	bwrapExecutable: string | null;
	distro: LinuxDistroInfo;
	isRoot: boolean;
	pacstrapExecutable: string | null;
	platform: NodeJS.Platform;
	sudoExecutable: string | null;
};

export type BpkgBoxRecord = {
	createdAt: number;
	description?: string;
	id: string;
	lastError?: string;
	name: string;
	packages: string[];
	rootPath: string;
	status: BpkgBoxStatus;
	updatedAt: number;
};

export type BpkgCommandResult = {
	boxId: string;
	command: string[];
	commandString: string;
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type BpkgBindingExecutionResult = BpkgCommandResult & {
	bindingId: string;
	parsed?: unknown;
	packageId: string;
	transpiled: BpkgTranspiledCommand;
};

export type BpkgInstallResult = {
	box: BpkgBoxRecord;
	commandResults: BpkgCommandResult[];
	packageIds: string[];
	pacmanPackages: string[];
	paruPackages: string[];
};

export type BpkgListResult = {
	boxes: BpkgBoxRecord[];
	defaultBoxId: string | null;
	hostInfo: BpkgHostInfo;
};

type PersistedBpkgRegistry = {
	boxes: BpkgBoxRecord[];
	defaultBoxId: string | null;
};

type CreateBoxOptions = {
	description?: string;
	id?: string;
	name?: string;
	packages?: readonly string[];
};

type ExecuteBoxCommandOptions = {
	argv?: readonly string[];
	command?: string;
	cwd?: string;
	env?: Record<string, string>;
	useDefaultBox?: boolean;
};

type HostRunner = "bwrap" | "pacstrap";

export class BpkgCommandError extends Error {
	constructor(public readonly result: BpkgCommandResult) {
		super(
			[
				`bpkg command failed with exit code ${result.exitCode}.`,
				`Command: ${result.commandString}`,
				result.stderr || result.stdout || "bpkg command failed without output.",
			].join("\n"),
		);
		this.name = "BpkgCommandError";
	}
}

export class BpkgUnsupportedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BpkgUnsupportedError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

function normalizeString(value: unknown, fieldName: string): string {
	if (typeof value !== "string") {
		throw new Error(`${fieldName} must be a string.`);
	}

	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new Error(`${fieldName} must be a non-empty string.`);
	}

	return normalized;
}

function normalizeOptionalString(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	return normalizeString(value, fieldName);
}

function normalizeStringArray(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function slugifyBoxId(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");

	if (slug.length === 0) {
		throw new Error("bpkg box id cannot be empty.");
	}

	return slug;
}

function cloneBox(box: BpkgBoxRecord): BpkgBoxRecord {
	return {
		...box,
		packages: [...box.packages],
	};
}

function resolveAvailableManifestDependencyCommand(dependencyId: string): string | null {
	const dependency = $manifest.refreshDependency(dependencyId);
	if (!dependency.available) {
		return null;
	}

	return dependency.resolvedPath ?? dependency.resolvedBinary ?? dependency.binary;
}

export class BpkgKit extends Kit {
	private readonly dataRoot: string;
	private readonly registryPath: string;
	private registry: PersistedBpkgRegistry = {
		boxes: [],
		defaultBoxId: null,
	};
	private hostInfo: BpkgHostInfo = {
		archCompatible: false,
		bwrapExecutable: null,
		distro: {
			id: null,
			idLike: [],
			name: null,
			prettyName: null,
			versionId: null,
		},
		isRoot: false,
		pacstrapExecutable: null,
		platform: process.platform,
		sudoExecutable: null,
	};

	constructor(options: { dataRoot?: string } = {}) {
		super({
			id: BPKG_KIT_ID,
			name: "BPkg Kit",
			description: "Manage Arch bubblewrap/pacstrap boxes and supported package bindings.",
		});
		this.dataRoot = path.resolve(options.dataRoot ?? resolveWritableRuntimePath("data"));
		this.registryPath = path.join(this.dataRoot, "bpkg", "registry.json");
	}

	protected override async onStart(_context: KitLifecycleContext): Promise<void> {
		await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
		this.registry = await this.loadRegistry();
		this.hostInfo = await this.detectHostInfo();
		this.registry.boxes = await Promise.all(this.registry.boxes.map(async (box) => await this.refreshBoxRecord(box)));
		if (this.registry.defaultBoxId && !this.registry.boxes.some((box) => box.id === this.registry.defaultBoxId)) {
			this.registry.defaultBoxId = null;
		}
		await this.persistRegistry();
	}

	async getHostInfo(): Promise<BpkgHostInfo> {
		return structuredClone(this.hostInfo);
	}

	listBoxes(): BpkgBoxRecord[] {
		return this.registry.boxes
			.map(cloneBox)
			.sort((left, right) => left.id.localeCompare(right.id));
	}

	getDefaultBoxId(): string | null {
		return this.registry.defaultBoxId;
	}

	getDefaultBox(): BpkgBoxRecord | null {
		if (!this.registry.defaultBoxId) {
			return null;
		}

		return this.getBox(this.registry.defaultBoxId);
	}

	getBox(boxId: string): BpkgBoxRecord | null {
		const normalizedBoxId = slugifyBoxId(boxId);
		const box = this.registry.boxes.find((entry) => entry.id === normalizedBoxId);
		return box ? cloneBox(box) : null;
	}

	listSupportedPackages(): BpkgSupportedPackageSummary[] {
		return listRegisteredBpkgPackages();
	}

	inspect(): BpkgListResult {
		return {
			boxes: this.listBoxes(),
			defaultBoxId: this.getDefaultBoxId(),
			hostInfo: structuredClone(this.hostInfo),
		};
	}

	async createBox(options: CreateBoxOptions): Promise<BpkgBoxRecord> {
		this.assertArchCompatible();

		const candidateId = options.id ?? options.name;
		if (!candidateId) {
			throw new Error("bpkg box creation requires an id or name.");
		}

		const boxId = slugifyBoxId(candidateId);
		const existingBox = this.registry.boxes.find((entry) => entry.id === boxId);
		const now = Date.now();
		const workingBox: BpkgBoxRecord = existingBox
			? {
				...existingBox,
				...(options.description ? { description: options.description } : {}),
				name: options.name?.trim() || existingBox.name,
				packages: [...existingBox.packages],
				rootPath: this.resolveBoxRootPath(boxId),
				status: "building",
				updatedAt: now,
				lastError: undefined,
			}
			: {
				createdAt: now,
				...(options.description ? { description: options.description } : {}),
				id: boxId,
				name: options.name?.trim() || boxId,
				packages: [],
				rootPath: this.resolveBoxRootPath(boxId),
				status: "building",
				updatedAt: now,
			};

		this.upsertBox(workingBox);
		await this.persistRegistry();

		try {
			await this.bootstrapBoxRoot(workingBox);
			workingBox.status = "ready";
			workingBox.updatedAt = Date.now();
			delete workingBox.lastError;
			this.upsertBox(workingBox);
			if (!this.registry.defaultBoxId) {
				this.registry.defaultBoxId = workingBox.id;
			}
			await this.persistRegistry();

			const requestedPackageIds = normalizeStringArray(options.packages ?? []);
			if (requestedPackageIds.length > 0) {
				await this.installSupportedPackages(requestedPackageIds, workingBox.id);
			}

			return this.requireBox(workingBox.id);
		} catch (error) {
			workingBox.status = "error";
			workingBox.updatedAt = Date.now();
			workingBox.lastError = error instanceof Error ? error.message : String(error);
			this.upsertBox(workingBox);
			await this.persistRegistry();
			throw error;
		}
	}

	async selectDefaultBox(boxId: string): Promise<BpkgBoxRecord> {
		const box = this.requireBox(boxId);
		this.registry.defaultBoxId = box.id;
		await this.persistRegistry();
		return box;
	}

	async installSupportedPackages(packageIds: readonly string[], boxId?: string): Promise<BpkgInstallResult> {
		const normalizedPackageIds = normalizeStringArray(packageIds);
		if (normalizedPackageIds.length === 0) {
			throw new Error("bpkg installation requires at least one supported package id.");
		}

		const targetBox = await this.ensureBoxReady(this.resolveTargetBoxId(boxId));
		const packageDefinitions = normalizedPackageIds.map((packageId) => {
			const packageDefinition = getRegisteredBpkgPackage(packageId);
			if (!packageDefinition) {
				throw new Error(`Unsupported bpkg package '${packageId}'.`);
			}

			return packageDefinition;
		});

		const pendingDefinitions = packageDefinitions.filter(
			(packageDefinition) => !targetBox.packages.includes(packageDefinition.id),
		);
		if (pendingDefinitions.length === 0) {
			return {
				box: targetBox,
				commandResults: [],
				packageIds: [],
				pacmanPackages: [],
				paruPackages: [],
			};
		}

		const pacmanPackages = normalizeStringArray(
			pendingDefinitions.flatMap((packageDefinition) => packageDefinition.dependency.pacman ?? []),
		);
		const paruPackages = normalizeStringArray(
			pendingDefinitions.flatMap((packageDefinition) => packageDefinition.dependency.paru ?? []),
		);

		if (paruPackages.length > 0) {
			throw new BpkgUnsupportedError(
				"bpkg AUR/paru dependency installation is not implemented yet inside boxes.",
			);
		}

		const commandResults: BpkgCommandResult[] = [];
		if (pacmanPackages.length > 0) {
			commandResults.push(await this.installPacmanPackagesIntoBox(targetBox, pacmanPackages));
		}

		const updatedBox = {
			...targetBox,
			packages: normalizeStringArray([...targetBox.packages, ...pendingDefinitions.map((packageDefinition) => packageDefinition.id)]),
			updatedAt: Date.now(),
		};
		this.upsertBox(updatedBox);
		await this.persistRegistry();

		return {
			box: updatedBox,
			commandResults,
			packageIds: pendingDefinitions.map((packageDefinition) => packageDefinition.id),
			pacmanPackages,
			paruPackages,
		};
	}

	async executeBoxCommand(
		boxId: string,
		execution: ExecuteBoxCommandOptions,
	): Promise<BpkgCommandResult> {
		const targetBox = await this.ensureBoxReady(boxId);
		const bwrapExecutable = this.assertBwrapSupported();
		const homePath = this.resolveBoxHomePath(targetBox.id);
		await fs.mkdir(homePath, { recursive: true });

		const envArgs = Object.entries(execution.env ?? {}).flatMap(([key, value]) => [
			"--setenv",
			key,
			value,
		]);
		const command = [
			bwrapExecutable,
			"--ro-bind",
			targetBox.rootPath,
			"/",
			"--dev",
			"/dev",
			"--proc",
			"/proc",
			"--tmpfs",
			"/tmp",
			"--bind",
			homePath,
			"/root",
			"--ro-bind",
			"/etc/resolv.conf",
			"/etc/resolv.conf",
			"--setenv",
			"HOME",
			"/root",
			"--setenv",
			"USER",
			"root",
			...(execution.cwd ? ["--chdir", execution.cwd] : ["--chdir", "/root"]),
			...envArgs,
			"--unshare-all",
			"--share-net",
			"--hostname",
			`${targetBox.id}-box`,
			...(execution.argv && execution.argv.length > 0
				? [...execution.argv]
				: ["/bin/bash", "-lc", normalizeString(execution.command, "command")]),
		];

		return await this.runCommand(targetBox.id, command, { runner: "bwrap" });
	}

	async executePackageBinding(
		packageId: string,
		bindingId: string,
		params: unknown,
	): Promise<BpkgBindingExecutionResult> {
		const packageDefinition = getRegisteredBpkgPackage(packageId);
		if (!packageDefinition) {
			throw new Error(`Unsupported bpkg package '${packageId}'.`);
		}

		const targetBox = this.getDefaultBox();
		if (!targetBox) {
			throw new Error(
				`No default bpkg box is selected. Create or select one with $.bpkg.create(...) or $.bpkg.select("${packageId}").`,
			);
		}

		if (!targetBox.packages.includes(packageId)) {
			throw new Error(
				`Package '${packageId}' is not installed in bpkg box '${targetBox.id}'. Run $.bpkg.install("${packageId}") first.`,
			);
		}

		const transformer = packageDefinition.transformers[bindingId];
		if (!transformer) {
			throw new Error(`Unsupported bpkg binding '${packageId}/${bindingId}'.`);
		}

		const bindingDefinition = getBpkgBindingDefinition(packageDefinition, bindingId);
		const normalizedParams = normalizeBpkgBindingParams(packageDefinition, bindingId, params);
		const transpiled = await transformer(normalizedParams, {
			bindingId,
			packageId,
			packageName: packageDefinition.package,
		});
		const result = await this.executeBoxCommand(targetBox.id, transpiled);
		const parsed = bindingDefinition.responseParser
			? await bindingDefinition.responseParser(result, {
				bindingId,
				boxId: targetBox.id,
				packageId,
				packageName: packageDefinition.package,
				params: normalizedParams,
				readFile: async (filePath) => {
					const fileResult = await this.executeBoxCommand(targetBox.id, {
						argv: ["cat", filePath],
					});
					return fileResult.stdout;
				},
				transpiled,
			})
			: undefined;
		return {
			...result,
			bindingId,
			...(parsed !== undefined ? { parsed } : {}),
			packageId,
			transpiled,
		};
	}

	private async loadRegistry(): Promise<PersistedBpkgRegistry> {
		try {
			const payload = await fs.readFile(this.registryPath, "utf8");
			const parsed = JSON.parse(payload) as Partial<PersistedBpkgRegistry>;
			return {
				boxes: Array.isArray(parsed.boxes)
					? parsed.boxes.map((box) => ({
						...box,
						packages: Array.isArray(box.packages) ? normalizeStringArray(box.packages) : [],
						rootPath: typeof box.rootPath === "string" && box.rootPath.length > 0
							? box.rootPath
							: this.resolveBoxRootPath(box.id),
					}))
					: [],
				defaultBoxId: typeof parsed.defaultBoxId === "string" ? parsed.defaultBoxId : null,
			};
		} catch {
			return {
				boxes: [],
				defaultBoxId: null,
			};
		}
	}

	private async persistRegistry(): Promise<void> {
		await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
		await fs.writeFile(this.registryPath, JSON.stringify(this.registry, null, 2), "utf8");
	}

	private upsertBox(box: BpkgBoxRecord): void {
		const index = this.registry.boxes.findIndex((entry) => entry.id === box.id);
		if (index >= 0) {
			this.registry.boxes[index] = cloneBox(box);
			return;
		}

		this.registry.boxes.push(cloneBox(box));
	}

	private requireBox(boxId: string): BpkgBoxRecord {
		const box = this.getBox(boxId);
		if (!box) {
			throw new Error(`Unknown bpkg box '${boxId}'.`);
		}

		return box;
	}

	private async refreshBoxRecord(box: BpkgBoxRecord): Promise<BpkgBoxRecord> {
		const shellPath = path.join(box.rootPath, "usr", "bin", "bash");
		const hasShell = await fs.stat(shellPath).then(() => true).catch(() => false);
		return {
			...box,
			packages: normalizeStringArray(box.packages),
			status: hasShell ? (box.status === "error" ? "ready" : box.status === "building" ? "ready" : box.status) : "missing",
		};
	}

	private resolveBoxRootPath(boxId: string): string {
		return path.resolve(this.dataRoot, `container-${boxId}`);
	}

	private resolveBoxHomePath(boxId: string): string {
		return path.resolve(this.dataRoot, "bpkg", "boxes", boxId, "home");
	}

	private resolveTargetBoxId(boxId: string | undefined): string {
		if (boxId) {
			return slugifyBoxId(boxId);
		}

		if (!this.registry.defaultBoxId) {
			throw new Error("No default bpkg box is selected.");
		}

		return this.registry.defaultBoxId;
	}

	private async ensureBoxReady(boxId: string): Promise<BpkgBoxRecord> {
		const existingBox = this.requireBox(boxId);
		const refreshedBox = await this.refreshBoxRecord(existingBox);
		this.upsertBox(refreshedBox);
		if (refreshedBox.status === "ready") {
			await this.persistRegistry();
			return refreshedBox;
		}

		return await this.createBox({
			description: refreshedBox.description,
			id: refreshedBox.id,
			name: refreshedBox.name,
		});
	}

	private async bootstrapBoxRoot(box: BpkgBoxRecord): Promise<void> {
		const shellPath = path.join(box.rootPath, "usr", "bin", "bash");
		const hasShell = await fs.stat(shellPath).then(() => true).catch(() => false);
		if (!hasShell) {
			await fs.mkdir(path.dirname(box.rootPath), { recursive: true });
			await fs.mkdir(box.rootPath, { recursive: true });
			const pacstrapExecutable = this.assertPacstrapSupported();
			const command = this.prefixWithSudoIfNeeded([
				pacstrapExecutable,
				"-K",
				"-c",
				box.rootPath,
				"base",
				"bash",
				"coreutils",
				"pacman",
				"--nodeps",
			]);
			await this.runCommand(box.id, command, { runner: "pacstrap" });
			await this.disableCheckSpace(box.rootPath);
		}

		await fs.mkdir(this.resolveBoxHomePath(box.id), { recursive: true });
	}

	private async disableCheckSpace(rootPath: string): Promise<void> {
		const pacmanConfigPath = path.join(rootPath, "etc", "pacman.conf");
		try {
			const configText = await fs.readFile(pacmanConfigPath, "utf8");
			const nextText = configText.replace(/^CheckSpace$/gmu, "#CheckSpace");
			if (nextText !== configText) {
				await fs.writeFile(pacmanConfigPath, nextText, "utf8");
			}
		} catch {
			// Best effort.
		}
	}

	private async installPacmanPackagesIntoBox(
		box: BpkgBoxRecord,
		packages: readonly string[],
	): Promise<BpkgCommandResult> {
		const pacstrapExecutable = this.assertPacstrapSupported();
		const command = this.prefixWithSudoIfNeeded([
			pacstrapExecutable,
			"-K",
			"-c",
			box.rootPath,
			...packages,
		]);
		return await this.runCommand(box.id, command, { runner: "pacstrap" });
	}

	private async detectHostInfo(): Promise<BpkgHostInfo> {
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
			bwrapExecutable: resolveAvailableManifestDependencyCommand(BWRAP_DEPENDENCY_ID),
			distro,
			isRoot: typeof process.getuid === "function" ? process.getuid() === 0 : false,
			pacstrapExecutable: resolveAvailableManifestDependencyCommand(PACSTRAP_DEPENDENCY_ID),
			platform: process.platform,
			sudoExecutable: resolveAvailableManifestDependencyCommand(SUDO_DEPENDENCY_ID),
		};
	}

	private assertArchCompatible(): void {
		if (this.hostInfo.archCompatible) {
			return;
		}

		const detectedDistro = this.hostInfo.distro.id ?? this.hostInfo.distro.prettyName ?? this.hostInfo.platform;
		throw new BpkgUnsupportedError(`bpkg boxes are only supported on Arch Linux hosts; detected ${detectedDistro}.`);
	}

	private assertBwrapSupported(): string {
		this.assertArchCompatible();
		if (!this.hostInfo.bwrapExecutable) {
			throw new BpkgUnsupportedError(
				"bubblewrap executable was not found on this host. Update manifest.dependencies.bwrap.binary or install bubblewrap in PATH.",
			);
		}

		return this.hostInfo.bwrapExecutable;
	}

	private assertPacstrapSupported(): string {
		this.assertArchCompatible();
		if (!this.hostInfo.pacstrapExecutable) {
			throw new BpkgUnsupportedError(
				"pacstrap executable was not found on this host. Update manifest.dependencies.pacstrap.binary or install arch-install-scripts in PATH.",
			);
		}

		return this.hostInfo.pacstrapExecutable;
	}

	private assertSudoSupported(): string {
		if (!this.hostInfo.sudoExecutable) {
			throw new BpkgUnsupportedError(
				"sudo is required for this bpkg operation but is not available. Update manifest.dependencies.sudo.binary or install sudo in PATH.",
			);
		}

		return this.hostInfo.sudoExecutable;
	}

	private prefixWithSudoIfNeeded(command: readonly string[]): string[] {
		if (this.hostInfo.isRoot) {
			return [...command];
		}

		return [this.assertSudoSupported(), "-n", ...command];
	}

	private async runCommand(
		boxId: string,
		command: readonly string[],
		options: { allowFailure?: boolean; runner: HostRunner },
	): Promise<BpkgCommandResult> {
		const child = Bun.spawn({
			cmd: [...command],
			cwd: process.cwd(),
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});

		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			readOutput(child.stdout),
			readOutput(child.stderr),
		]);

		const result: BpkgCommandResult = {
			boxId,
			command: [...command],
			commandString: formatCommand(command),
			exitCode,
			stderr,
			stdout,
		};

		if (exitCode !== 0 && !options.allowFailure) {
			throw new BpkgCommandError(result);
		}

		return result;
	}
}