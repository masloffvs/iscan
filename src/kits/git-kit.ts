import fs from "node:fs/promises";
import path from "node:path";

import { resolveWritableRuntimePath } from "../runtime-paths";
import { Kit, type KitLifecycleContext } from "./kit";

export const GIT_KIT_ID = "git";

const GIT_COMMAND = ["git"] as const;

export type GitWorkingDirectory = {
	dataRoot: string;
	logicalPath: string;
	realPath: string;
};

export type GitCommandResult = {
	command: string[];
	commandString: string;
	cwd: GitWorkingDirectory;
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type GitCloneOptions = {
	branch?: string;
	cwd?: string;
	depth?: number;
	directory?: string;
	quiet?: boolean;
	recurseSubmodules?: boolean;
	remoteName?: string;
	shallowSubmodules?: boolean;
	singleBranch?: boolean;
};

export type GitInitOptions = {
	bare?: boolean;
	branch?: string;
	cwd?: string;
	path?: string;
	quiet?: boolean;
};

export type GitStatusOptions = {
	branch?: boolean;
	cwd?: string;
	showStash?: boolean;
	short?: boolean;
	untrackedFiles?: "all" | "no" | "normal";
};

export type GitBranchOptions = {
	all?: boolean;
	contains?: string;
	cwd?: string;
	format?: string;
	merged?: string;
	noMerged?: string;
	remotes?: boolean;
	sort?: string;
	verbose?: boolean;
};

export type GitLogOptions = {
	author?: string;
	cwd?: string;
	format?: string;
	grep?: string;
	maxCount?: number;
	oneline?: boolean;
	paths?: readonly string[];
	ref?: string;
	stat?: boolean;
};

export type GitDiffOptions = {
	base?: string;
	cached?: boolean;
	cwd?: string;
	head?: string;
	nameOnly?: boolean;
	paths?: readonly string[];
	stat?: boolean;
};

export type GitAddOptions = {
	all?: boolean;
	cwd?: string;
	force?: boolean;
	paths?: readonly string[];
	update?: boolean;
	verbose?: boolean;
};

export type GitCommitOptions = {
	all?: boolean;
	allowEmpty?: boolean;
	author?: string;
	cwd?: string;
	message?: string;
	noVerify?: boolean;
};

export type GitRestoreOptions = {
	cwd?: string;
	paths?: readonly string[];
	source?: string;
	staged?: boolean;
	worktree?: boolean;
};

export type GitFetchOptions = {
	all?: boolean;
	branch?: string;
	cwd?: string;
	depth?: number;
	prune?: boolean;
	remote?: string;
	tags?: boolean;
};

export type GitPullOptions = {
	branch?: string;
	cwd?: string;
	ffOnly?: boolean;
	prune?: boolean;
	rebase?: boolean;
	remote?: string;
};

export type GitPushOptions = {
	branch?: string;
	cwd?: string;
	force?: boolean;
	remote?: string;
	setUpstream?: boolean;
	tags?: boolean;
};

export type GitCheckoutOptions = {
	cwd?: string;
	detach?: boolean;
	ref?: string;
};

export type GitSwitchOptions = {
	cwd?: string;
	detach?: boolean;
	target?: string;
};

export type GitBranchCreateOptions = {
	cwd?: string;
	name?: string;
	startPoint?: string;
};

export type GitBranchDeleteOptions = {
	cwd?: string;
	force?: boolean;
	name?: string;
};

export type GitMergeOptions = {
	cwd?: string;
	ffOnly?: boolean;
	message?: string;
	noCommit?: boolean;
	noFf?: boolean;
	ref?: string;
	squash?: boolean;
};

export type GitRebaseOptions = {
	autostash?: boolean;
	branch?: string;
	cwd?: string;
	onto?: string;
	upstream?: string;
};

export type GitTagOptions = {
	contains?: string;
	cwd?: string;
	format?: string;
	merged?: string;
	noMerged?: string;
	pointsAt?: string;
	sort?: string;
};

export type GitTagCreateOptions = {
	annotate?: boolean;
	cwd?: string;
	force?: boolean;
	message?: string;
	name?: string;
	ref?: string;
};

export type GitTagDeleteOptions = {
	cwd?: string;
	name?: string;
};

type GitResolvedPath = {
	logicalPath: string;
	realPath: string;
};

export class GitCommandError extends Error {
	constructor(public readonly result: GitCommandResult) {
		super(buildGitCommandErrorMessage(result));
		this.name = "GitCommandError";
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

function buildGitCommandErrorMessage(result: GitCommandResult): string {
	const output = result.stderr || result.stdout || "Git command failed without output.";
	return [
		`Git command failed with exit code ${result.exitCode}.`,
		`Command: ${result.commandString}`,
		`Cwd: ${result.cwd.realPath}`,
		output,
	].join("\n");
}

function isNodeErrorWithCode(error: unknown, code: string): error is { code: string } {
	return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function appendPathspec(command: string[], paths: readonly string[] | undefined): void {
	if (!paths || paths.length === 0) {
		return;
	}

	command.push("--", ...paths);
}

export class GitKit extends Kit {
	private readonly dataRoot: string;
	private logicalCwd = "/";

	constructor(options: { dataRoot?: string } = {}) {
		super({
			id: GIT_KIT_ID,
			name: "Git Kit",
			description: "Run Git commands inside the real data/ workspace subtree",
		});
		this.dataRoot = path.resolve(options.dataRoot ?? resolveWritableRuntimePath("data"));
	}

	protected override async onStart(_context: KitLifecycleContext): Promise<void> {
		await fs.mkdir(this.dataRoot, { recursive: true });
		const stats = await fs.stat(this.dataRoot);
		if (!stats.isDirectory()) {
			throw new Error(`Git data root is not a directory: ${this.dataRoot}`);
		}
	}

	getDataRoot(): string {
		return this.dataRoot;
	}

	async pwd(): Promise<GitWorkingDirectory> {
		return await this.resolveWorkingDirectory();
	}

	async cd(targetPath: string): Promise<GitWorkingDirectory> {
		const resolvedDirectory = await this.resolveWorkingDirectory(targetPath);
		this.logicalCwd = resolvedDirectory.logicalPath;
		return resolvedDirectory;
	}

	async clone(repo: string, options: GitCloneOptions = {}): Promise<GitCommandResult> {
		const effectiveCwd = await this.resolveWorkingDirectory(options.cwd);
		const command = [...GIT_COMMAND, "clone"];
		if (options.quiet) {
			command.push("--quiet");
		}
		if (options.branch) {
			command.push("--branch", options.branch);
		}
		if (typeof options.depth === "number") {
			command.push("--depth", String(options.depth));
		}
		if (options.recurseSubmodules) {
			command.push("--recurse-submodules");
		}
		if (options.shallowSubmodules) {
			command.push("--shallow-submodules");
		}
		if (options.singleBranch) {
			command.push("--single-branch");
		}
		if (options.remoteName) {
			command.push("--origin", options.remoteName);
		}
		command.push(repo);
		if (options.directory) {
			const targetPath = await this.resolveCreatablePath(options.directory, effectiveCwd.logicalPath);
			await this.ensureTargetParentDirectory(targetPath.realPath);
			command.push(targetPath.realPath);
		}
		return await this.runCommand(command, { cwd: effectiveCwd.logicalPath });
	}

	async init(options: GitInitOptions = {}): Promise<GitCommandResult> {
		const effectiveCwd = await this.resolveWorkingDirectory(options.cwd);
		const command = [...GIT_COMMAND, "init"];
		if (options.quiet) {
			command.push("--quiet");
		}
		if (options.bare) {
			command.push("--bare");
		}
		if (options.branch) {
			command.push("--initial-branch", options.branch);
		}
		if (options.path) {
			const targetPath = await this.resolveCreatablePath(options.path, effectiveCwd.logicalPath);
			await this.ensureTargetParentDirectory(targetPath.realPath);
			command.push(targetPath.realPath);
		}
		return await this.runCommand(command, { cwd: effectiveCwd.logicalPath });
	}

	async status(options: GitStatusOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "status"];
		if (options.short) {
			command.push("--short");
		}
		if (options.branch) {
			command.push("--branch");
		}
		if (options.showStash) {
			command.push("--show-stash");
		}
		if (options.untrackedFiles) {
			command.push(`--untracked-files=${options.untrackedFiles}`);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async branch(options: GitBranchOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "branch"];
		if (options.all) {
			command.push("--all");
		}
		if (options.verbose) {
			command.push("--verbose");
		}
		if (options.remotes) {
			command.push("--remotes");
		}
		if (options.contains) {
			command.push("--contains", options.contains);
		}
		if (options.merged) {
			command.push("--merged", options.merged);
		}
		if (options.noMerged) {
			command.push("--no-merged", options.noMerged);
		}
		if (options.sort) {
			command.push("--sort", options.sort);
		}
		if (options.format) {
			command.push("--format", options.format);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async log(options: GitLogOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "log"];
		if (typeof options.maxCount === "number") {
			command.push(`--max-count=${options.maxCount}`);
		}
		if (options.oneline) {
			command.push("--oneline");
		}
		if (options.stat) {
			command.push("--stat");
		}
		if (options.author) {
			command.push("--author", options.author);
		}
		if (options.grep) {
			command.push("--grep", options.grep);
		}
		if (options.format) {
			command.push("--format", options.format);
		}
		if (options.ref) {
			command.push(options.ref);
		}
		if (options.paths && options.paths.length > 0) {
			command.push("--", ...options.paths);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async diff(options: GitDiffOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "diff"];
		if (options.cached) {
			command.push("--cached");
		}
		if (options.nameOnly) {
			command.push("--name-only");
		}
		if (options.stat) {
			command.push("--stat");
		}
		if (options.base) {
			command.push(options.base);
		}
		if (options.head) {
			command.push(options.head);
		}
		appendPathspec(command, options.paths);
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async add(options: GitAddOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "add"];
		if (options.all) {
			command.push("--all");
		}
		if (options.update) {
			command.push("--update");
		}
		if (options.force) {
			command.push("--force");
		}
		if (options.verbose) {
			command.push("--verbose");
		}
		appendPathspec(command, options.paths);
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async commit(options: GitCommitOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "commit"];
		if (options.all) {
			command.push("--all");
		}
		if (options.noVerify) {
			command.push("--no-verify");
		}
		if (options.allowEmpty) {
			command.push("--allow-empty");
		}
		if (options.author) {
			command.push("--author", options.author);
		}
		if (options.message) {
			command.push("--message", options.message);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async restore(options: GitRestoreOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "restore"];
		if (options.staged) {
			command.push("--staged");
		}
		if (options.worktree) {
			command.push("--worktree");
		}
		if (options.source) {
			command.push("--source", options.source);
		}
		appendPathspec(command, options.paths);
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async fetch(options: GitFetchOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "fetch"];
		if (options.all) {
			command.push("--all");
		}
		if (options.prune) {
			command.push("--prune");
		}
		if (options.tags) {
			command.push("--tags");
		}
		if (typeof options.depth === "number") {
			command.push("--depth", String(options.depth));
		}
		if (options.remote) {
			command.push(options.remote);
		}
		if (options.branch) {
			command.push(options.branch);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async pull(options: GitPullOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "pull"];
		if (options.rebase) {
			command.push("--rebase");
		}
		if (options.ffOnly) {
			command.push("--ff-only");
		}
		if (options.prune) {
			command.push("--prune");
		}
		if (options.remote) {
			command.push(options.remote);
		}
		if (options.branch) {
			command.push(options.branch);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async push(options: GitPushOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "push"];
		if (options.force) {
			command.push("--force");
		}
		if (options.setUpstream) {
			command.push("--set-upstream");
		}
		if (options.tags) {
			command.push("--tags");
		}
		if (options.remote) {
			command.push(options.remote);
		}
		if (options.branch) {
			command.push(options.branch);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async checkout(options: GitCheckoutOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "checkout"];
		if (options.detach) {
			command.push("--detach");
		}
		if (options.ref) {
			command.push(options.ref);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async switch(options: GitSwitchOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "switch"];
		if (options.detach) {
			command.push("--detach");
		}
		if (options.target) {
			command.push(options.target);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async createBranch(options: GitBranchCreateOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "branch"];
		if (options.name) {
			command.push(options.name);
		}
		if (options.startPoint) {
			command.push(options.startPoint);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async deleteBranch(options: GitBranchDeleteOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "branch", options.force ? "-D" : "-d"];
		if (options.name) {
			command.push(options.name);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async merge(options: GitMergeOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "merge"];
		if (options.ffOnly) {
			command.push("--ff-only");
		}
		if (options.noFf) {
			command.push("--no-ff");
		}
		if (options.noCommit) {
			command.push("--no-commit");
		}
		if (options.squash) {
			command.push("--squash");
		}
		if (options.message) {
			command.push("--message", options.message);
		}
		if (options.ref) {
			command.push(options.ref);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async rebase(options: GitRebaseOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "rebase"];
		if (options.autostash) {
			command.push("--autostash");
		}
		if (options.onto) {
			command.push("--onto", options.onto);
		}
		if (options.upstream) {
			command.push(options.upstream);
		}
		if (options.branch) {
			command.push(options.branch);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async tag(options: GitTagOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "tag", "--list"];
		if (options.contains) {
			command.push("--contains", options.contains);
		}
		if (options.merged) {
			command.push("--merged", options.merged);
		}
		if (options.noMerged) {
			command.push("--no-merged", options.noMerged);
		}
		if (options.pointsAt) {
			command.push("--points-at", options.pointsAt);
		}
		if (options.sort) {
			command.push("--sort", options.sort);
		}
		if (options.format) {
			command.push("--format", options.format);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async createTag(options: GitTagCreateOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "tag"];
		if (options.annotate || options.message) {
			command.push("--annotate");
		}
		if (options.force) {
			command.push("--force");
		}
		if (options.message) {
			command.push("--message", options.message);
		}
		if (options.name) {
			command.push(options.name);
		}
		if (options.ref) {
			command.push(options.ref);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	async deleteTag(options: GitTagDeleteOptions = {}): Promise<GitCommandResult> {
		const command = [...GIT_COMMAND, "tag", "--delete"];
		if (options.name) {
			command.push(options.name);
		}
		return await this.runCommand(command, { cwd: options.cwd });
	}

	private normalizeLogicalPath(targetPath?: string, baseLogicalPath = this.logicalCwd): string {
		if (!targetPath || targetPath.trim().length === 0) {
			return baseLogicalPath;
		}

		const normalizedInput = targetPath.trim().replace(/\\/gu, "/");
		return path.posix.resolve("/", baseLogicalPath, normalizedInput);
	}

	private async resolveWorkingDirectory(
		targetPath?: string,
		baseLogicalPath = this.logicalCwd,
	): Promise<GitWorkingDirectory> {
		const resolvedPath = await this.resolveExistingPath(targetPath, "directory", baseLogicalPath);
		return {
			dataRoot: this.dataRoot,
			logicalPath: resolvedPath.logicalPath,
			realPath: resolvedPath.realPath,
		};
	}

	private async resolveExistingPath(
		targetPath: string | undefined,
		expectedKind: "directory" | "file",
		baseLogicalPath = this.logicalCwd,
	): Promise<GitResolvedPath> {
		const logicalPath = this.normalizeLogicalPath(targetPath, baseLogicalPath);
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

	private async resolveCreatablePath(targetPath: string, baseLogicalPath = this.logicalCwd): Promise<GitResolvedPath> {
		const logicalPath = this.normalizeLogicalPath(targetPath, baseLogicalPath);
		const relativePath = logicalPath === "/" ? "." : logicalPath.slice(1);
		const realPath = path.resolve(this.dataRoot, relativePath);
		this.assertWithinDataRoot(realPath);
		await this.assertCreatablePathWithinDataRoot(realPath);
		return {
			logicalPath,
			realPath,
		};
	}

	private async assertCreatablePathWithinDataRoot(candidatePath: string): Promise<void> {
		let currentPath = candidatePath;
		while (true) {
			try {
				const resolvedPath = await fs.realpath(currentPath);
				this.assertWithinDataRoot(resolvedPath);
				return;
			} catch (error) {
				if (!isNodeErrorWithCode(error, "ENOENT")) {
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

	private async ensureTargetParentDirectory(targetRealPath: string): Promise<void> {
		if (targetRealPath === this.dataRoot) {
			return;
		}

		const parentPath = path.dirname(targetRealPath);
		this.assertWithinDataRoot(parentPath);
		await fs.mkdir(parentPath, { recursive: true });
	}

	private assertWithinDataRoot(candidatePath: string): void {
		const normalizedRoot = this.dataRoot.endsWith(path.sep) ? this.dataRoot : `${this.dataRoot}${path.sep}`;
		if (candidatePath === this.dataRoot || candidatePath.startsWith(normalizedRoot)) {
			return;
		}

		throw new Error(`Path escapes the Git data root: ${candidatePath}`);
	}

	private async runCommand(command: readonly string[], options: { cwd?: string } = {}): Promise<GitCommandResult> {
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

		const result: GitCommandResult = {
			command: [...command],
			commandString: formatCommand(command),
			cwd,
			exitCode,
			stderr,
			stdout,
		};

		if (exitCode !== 0) {
			throw new GitCommandError(result);
		}

		return result;
	}
}