import fs from "node:fs/promises";
import path from "node:path";

import { resolveWritableRuntimePath } from "../runtime-paths";
import { Kit, type KitLifecycleContext } from "./kit";

export const DOCKER_KIT_ID = "docker";

const DOCKER_COMMAND = ["docker"] as const;
const DOCKER_COMPOSE_COMMAND = ["docker", "compose"] as const;

export type DockerWorkingDirectory = {
	dataRoot: string;
	logicalPath: string;
	realPath: string;
};

export type DockerCommandResult = {
	command: string[];
	commandString: string;
	cwd: DockerWorkingDirectory;
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type DockerPullOptions = {
	allTags?: boolean;
	cwd?: string;
	platform?: string;
	quiet?: boolean;
};

export type DockerPsOptions = {
	all?: boolean;
	cwd?: string;
	filter?: readonly string[];
	format?: string;
	noTrunc?: boolean;
	quiet?: boolean;
	size?: boolean;
};

export type DockerImagesOptions = {
	all?: boolean;
	cwd?: string;
	digests?: boolean;
	filter?: readonly string[];
	format?: string;
	noTrunc?: boolean;
	quiet?: boolean;
};

export type DockerInspectOptions = {
	cwd?: string;
	format?: string;
	size?: boolean;
	type?: string;
};

export type DockerBuildOptions = {
	buildArgs?: readonly string[];
	context?: string;
	cwd?: string;
	dockerfile?: string;
	noCache?: boolean;
	platform?: string;
	pull?: boolean;
	quiet?: boolean;
	tags?: readonly string[];
	target?: string;
};

export type DockerRunOptions = {
	command?: readonly string[];
	cwd?: string;
	detach?: boolean;
	env?: readonly string[];
	name?: string;
	network?: string;
	ports?: readonly string[];
	publishAll?: boolean;
	remove?: boolean;
	workdir?: string;
};

export type DockerExecOptions = {
	cwd?: string;
	detach?: boolean;
	env?: readonly string[];
	user?: string;
	workdir?: string;
};

export type DockerComposePullOptions = {
	cwd?: string;
	ignoreBuildable?: boolean;
	includeDeps?: boolean;
	quiet?: boolean;
	services?: readonly string[];
};

export type DockerComposeUpOptions = {
	build?: boolean;
	cwd?: string;
	detach?: boolean;
	forceRecreate?: boolean;
	removeOrphans?: boolean;
	services?: readonly string[];
	wait?: boolean;
};

export type DockerComposeDownOptions = {
	cwd?: string;
	images?: "all" | "local";
	removeOrphans?: boolean;
	timeout?: number;
	volumes?: boolean;
};

export type DockerComposePsOptions = {
	all?: boolean;
	cwd?: string;
	services?: readonly string[];
};

export type DockerComposeRestartOptions = {
	cwd?: string;
	services?: readonly string[];
	timeout?: number;
};

export type DockerComposeLogsTail = number | "all";

export type DockerComposeLogsOptions = {
	cwd?: string;
	noColor?: boolean;
	services?: readonly string[];
	since?: string;
	tail?: DockerComposeLogsTail;
	timestamps?: boolean;
};

export class DockerCommandError extends Error {
	constructor(public readonly result: DockerCommandResult) {
		super(buildDockerCommandErrorMessage(result));
		this.name = "DockerCommandError";
	}
}

type DockerResolvedPath = {
	logicalPath: string;
	realPath: string;
};

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

function buildDockerCommandErrorMessage(result: DockerCommandResult): string {
	const output = result.stderr || result.stdout || "Docker command failed without output.";
	return [
		`Docker command failed with exit code ${result.exitCode}.`,
		`Command: ${result.commandString}`,
		`Cwd: ${result.cwd.realPath}`,
		output,
	].join("\n");
}

function appendRepeatedFlag(command: string[], flag: string, values: readonly string[] | undefined): void {
	if (!values || values.length === 0) {
		return;
	}

	for (const value of values) {
		command.push(flag, value);
	}
}

function isNodeErrorWithCode(error: unknown, code: string): error is { code: string } {
	return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

export class DockerKit extends Kit {
	private readonly dataRoot: string;
	private logicalCwd = "/";

	constructor(options: { dataRoot?: string } = {}) {
		super({
			id: DOCKER_KIT_ID,
			name: "Docker Kit",
			description: "Run Docker and Docker Compose commands inside the real data/ workspace subtree",
		});
		this.dataRoot = path.resolve(options.dataRoot ?? resolveWritableRuntimePath("data"));
	}

	protected override async onStart(_context: KitLifecycleContext): Promise<void> {
		await fs.mkdir(this.dataRoot, { recursive: true });
		const stats = await fs.stat(this.dataRoot);
		if (!stats.isDirectory()) {
			throw new Error(`Docker data root is not a directory: ${this.dataRoot}`);
		}
	}

	getDataRoot(): string {
		return this.dataRoot;
	}

	async pwd(): Promise<DockerWorkingDirectory> {
		return await this.resolveWorkingDirectory();
	}

	async cd(targetPath: string): Promise<DockerWorkingDirectory> {
		const resolvedDirectory = await this.resolveWorkingDirectory(targetPath);
		this.logicalCwd = resolvedDirectory.logicalPath;
		return resolvedDirectory;
	}

	async pull(image: string, options: DockerPullOptions = {}): Promise<DockerCommandResult> {
		const command = [...DOCKER_COMMAND];
		command.push("pull");
		if (options.allTags) {
			command.push("--all-tags");
		}
		if (options.quiet) {
			command.push("--quiet");
		}
		if (options.platform) {
			command.push("--platform", options.platform);
		}
		command.push(image);
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async ps(options: DockerPsOptions = {}): Promise<DockerCommandResult> {
		const command = [...DOCKER_COMMAND, "ps"];
		if (options.all) {
			command.push("--all");
		}
		if (options.quiet) {
			command.push("--quiet");
		}
		if (options.noTrunc) {
			command.push("--no-trunc");
		}
		if (options.size) {
			command.push("--size");
		}
		if (options.format) {
			command.push("--format", options.format);
		}
		appendRepeatedFlag(command, "--filter", options.filter);
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async images(options: DockerImagesOptions = {}): Promise<DockerCommandResult> {
		const command = [...DOCKER_COMMAND, "images"];
		if (options.all) {
			command.push("--all");
		}
		if (options.quiet) {
			command.push("--quiet");
		}
		if (options.noTrunc) {
			command.push("--no-trunc");
		}
		if (options.digests) {
			command.push("--digests");
		}
		if (options.format) {
			command.push("--format", options.format);
		}
		appendRepeatedFlag(command, "--filter", options.filter);
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async inspect(targets: readonly string[], options: DockerInspectOptions = {}): Promise<DockerCommandResult> {
		const command = [...DOCKER_COMMAND, "inspect"];
		if (options.format) {
			command.push("--format", options.format);
		}
		if (options.size) {
			command.push("--size");
		}
		if (options.type) {
			command.push("--type", options.type);
		}
		command.push(...targets);
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async build(options: DockerBuildOptions = {}): Promise<DockerCommandResult> {
		const contextDirectory = await this.resolveWorkingDirectory(options.context);
		const command = [...DOCKER_COMMAND, "build"];
		if (options.pull) {
			command.push("--pull");
		}
		if (options.noCache) {
			command.push("--no-cache");
		}
		if (options.quiet) {
			command.push("--quiet");
		}
		if (options.platform) {
			command.push("--platform", options.platform);
		}
		if (options.target) {
			command.push("--target", options.target);
		}
		appendRepeatedFlag(command, "--tag", options.tags);
		appendRepeatedFlag(command, "--build-arg", options.buildArgs);
		if (options.dockerfile) {
			const dockerfilePath = await this.resolveExistingPath(options.dockerfile, "file");
			command.push("--file", dockerfilePath.realPath);
		}
		command.push(contextDirectory.realPath);
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async run(image: string, options: DockerRunOptions = {}): Promise<DockerCommandResult> {
		const command = [...DOCKER_COMMAND, "run"];
		if (options.detach) {
			command.push("--detach");
		}
		if (options.remove) {
			command.push("--rm");
		}
		if (options.publishAll) {
			command.push("--publish-all");
		}
		if (options.name) {
			command.push("--name", options.name);
		}
		if (options.network) {
			command.push("--network", options.network);
		}
		if (options.workdir) {
			command.push("--workdir", options.workdir);
		}
		appendRepeatedFlag(command, "--env", options.env);
		appendRepeatedFlag(command, "--publish", options.ports);
		command.push(image);
		if (options.command && options.command.length > 0) {
			command.push(...options.command);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async exec(container: string, commandArgs: readonly string[], options: DockerExecOptions = {}): Promise<DockerCommandResult> {
		const command = [...DOCKER_COMMAND, "exec"];
		if (options.detach) {
			command.push("--detach");
		}
		if (options.user) {
			command.push("--user", options.user);
		}
		if (options.workdir) {
			command.push("--workdir", options.workdir);
		}
		appendRepeatedFlag(command, "--env", options.env);
		command.push(container, ...commandArgs);
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async composePull(options: DockerComposePullOptions = {}): Promise<DockerCommandResult> {
		const command = [...DOCKER_COMPOSE_COMMAND, "pull"];
		if (options.includeDeps) {
			command.push("--include-deps");
		}
		if (options.ignoreBuildable) {
			command.push("--ignore-buildable");
		}
		if (options.quiet) {
			command.push("--quiet");
		}
		if (options.services && options.services.length > 0) {
			command.push(...options.services);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async composeUp(options: DockerComposeUpOptions = {}): Promise<DockerCommandResult> {
		const command = [...DOCKER_COMPOSE_COMMAND, "up"];
		if (options.detach) {
			command.push("-d");
		}
		if (options.build) {
			command.push("--build");
		}
		if (options.forceRecreate) {
			command.push("--force-recreate");
		}
		if (options.removeOrphans) {
			command.push("--remove-orphans");
		}
		if (options.wait) {
			command.push("--wait");
		}
		if (options.services && options.services.length > 0) {
			command.push(...options.services);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async composeDown(options: DockerComposeDownOptions = {}): Promise<DockerCommandResult> {
		const command = [...DOCKER_COMPOSE_COMMAND, "down"];
		if (options.removeOrphans) {
			command.push("--remove-orphans");
		}
		if (options.volumes) {
			command.push("--volumes");
		}
		if (options.images) {
			command.push("--rmi", options.images);
		}
		if (typeof options.timeout === "number") {
			command.push("--timeout", String(options.timeout));
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async composePs(options: DockerComposePsOptions = {}): Promise<DockerCommandResult> {
		const command = [...DOCKER_COMPOSE_COMMAND, "ps"];
		if (options.all) {
			command.push("--all");
		}
		if (options.services && options.services.length > 0) {
			command.push(...options.services);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async composeRestart(options: DockerComposeRestartOptions = {}): Promise<DockerCommandResult> {
		const command = [...DOCKER_COMPOSE_COMMAND, "restart"];
		if (typeof options.timeout === "number") {
			command.push("--timeout", String(options.timeout));
		}
		if (options.services && options.services.length > 0) {
			command.push(...options.services);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async composeLogs(options: DockerComposeLogsOptions = {}): Promise<DockerCommandResult> {
		const command = [...DOCKER_COMPOSE_COMMAND, "logs"];
		if (options.noColor) {
			command.push("--no-color");
		}
		if (options.timestamps) {
			command.push("--timestamps");
		}
		if (options.since) {
			command.push("--since", options.since);
		}
		if (options.tail !== undefined) {
			command.push("--tail", String(options.tail));
		}
		if (options.services && options.services.length > 0) {
			command.push(...options.services);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	private normalizeLogicalPath(targetPath?: string): string {
		if (!targetPath || targetPath.trim().length === 0) {
			return this.logicalCwd;
		}

		const normalizedInput = targetPath.trim().replace(/\\/gu, "/");
		return path.posix.resolve("/", this.logicalCwd, normalizedInput);
	}

	private async resolveWorkingDirectory(targetPath?: string): Promise<DockerWorkingDirectory> {
		const resolvedPath = await this.resolveExistingPath(targetPath, "directory");
		return {
			dataRoot: this.dataRoot,
			logicalPath: resolvedPath.logicalPath,
			realPath: resolvedPath.realPath,
		};
	}

	private async resolveExistingPath(
		targetPath: string | undefined,
		expectedKind: "directory" | "file",
	): Promise<DockerResolvedPath> {
		const logicalPath = this.normalizeLogicalPath(targetPath);
		const relativePath = logicalPath === "/" ? "." : logicalPath.slice(1);
		const realPath = path.resolve(this.dataRoot, relativePath);
		this.assertWithinDataRoot(realPath);

		let resolvedRealPath = realPath;
		try {
			resolvedRealPath = await fs.realpath(realPath);
			this.assertWithinDataRoot(resolvedRealPath);
		} catch (error) {
			if (!isNodeErrorWithCode(error, "ENOENT")) {
				throw error;
			}

			// Leave the unresolved path in place for user-facing errors below.
		}

		const stats = await fs.stat(realPath).catch(() => null);
		if (!stats) {
			throw new Error(`Path '${targetPath ?? logicalPath}' does not exist inside data/.`);
		}
		if (expectedKind === "directory" && !stats.isDirectory()) {
			throw new Error(`Path '${targetPath ?? logicalPath}' is not a directory inside data/.`);
		}
		if (expectedKind === "file" && !stats.isFile()) {
			throw new Error(`Path '${targetPath ?? logicalPath}' is not a file inside data/.`);
		}

		return {
			logicalPath,
			realPath: resolvedRealPath,
		};
	}

	private assertWithinDataRoot(candidatePath: string): void {
		const normalizedRoot = this.dataRoot.endsWith(path.sep) ? this.dataRoot : `${this.dataRoot}${path.sep}`;
		if (candidatePath === this.dataRoot || candidatePath.startsWith(normalizedRoot)) {
			return;
		}

		throw new Error(`Path escapes the Docker data root: ${candidatePath}`);
	}

	private async runCommand(command: readonly string[], options: { cwd?: string } = {}): Promise<DockerCommandResult> {
		const cwd = await this.resolveWorkingDirectory(options.cwd);
		const child = Bun.spawn({
			cmd: [...command],
			cwd: cwd.realPath,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});

		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			readOutput(child.stdout),
			readOutput(child.stderr),
		]);

		const result: DockerCommandResult = {
			command: [...command],
			commandString: formatCommand(command),
			cwd,
			exitCode,
			stderr,
			stdout,
		};

		if (exitCode !== 0) {
			throw new DockerCommandError(result);
		}

		return result;
	}
}