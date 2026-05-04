import {
	GIT_KIT_ID,
	GitKit,
	type GitAddOptions,
	type GitBranchOptions,
	type GitBranchCreateOptions,
	type GitBranchDeleteOptions,
	type GitCheckoutOptions,
	type GitCloneOptions,
	type GitCommitOptions,
	type GitCommandResult,
	type GitMergeOptions,
	type GitDiffOptions,
	type GitFetchOptions,
	type GitInitOptions,
	type GitLogOptions,
	type GitPullOptions,
	type GitPushOptions,
	type GitRebaseOptions,
	type GitRestoreOptions,
	type GitStatusOptions,
	type GitSwitchOptions,
	type GitTagCreateOptions,
	type GitTagDeleteOptions,
	type GitTagOptions,
	type GitWorkingDirectory,
} from "../kits";
import { InvalidParamsError } from "./errors";
import { defineExecutor, defineModule, type ModuleExecutionContext } from "./module";

type EnsureGitKitContext = Pick<ModuleExecutionContext<unknown, object>, "getKit" | "runtime">;

export type GitCdParams = {
	path?: string;
};

export type GitPwdResult = GitWorkingDirectory;

export type GitCloneParams = GitCloneOptions & {
	repo?: string;
};

export type GitInitParams = GitInitOptions;

export type GitStatusParams = GitStatusOptions;

export type GitBranchParams = GitBranchOptions;

export type GitLogParams = Omit<GitLogOptions, "paths"> & {
	paths?: readonly string[] | string;
};

export type GitDiffParams = Omit<GitDiffOptions, "cached" | "paths"> & {
	cached?: boolean;
	paths?: readonly string[] | string;
	staged?: boolean;
};

export type GitAddParams = Omit<GitAddOptions, "paths"> & {
	paths?: readonly string[] | string;
};

export type GitCommitParams = GitCommitOptions & {
	message?: string;
};

export type GitRestoreParams = Omit<GitRestoreOptions, "paths"> & {
	paths?: readonly string[] | string;
};

export type GitFetchParams = GitFetchOptions;

export type GitPullParams = GitPullOptions;

export type GitPushParams = GitPushOptions;

export type GitCheckoutParams = GitCheckoutOptions & {
	ref?: string;
};

export type GitSwitchParams = GitSwitchOptions & {
	target?: string;
};

export type GitBranchCreateParams = GitBranchCreateOptions & {
	name?: string;
};

export type GitBranchDeleteParams = GitBranchDeleteOptions & {
	name?: string;
};

export type GitMergeParams = GitMergeOptions & {
	ref?: string;
};

export type GitRebaseParams = GitRebaseOptions & {
	upstream?: string;
};

export type GitTagParams = GitTagOptions;

export type GitTagCreateParams = GitTagCreateOptions & {
	name?: string;
};

export type GitTagDeleteParams = GitTagDeleteOptions & {
	name?: string;
};

async function ensureGitKit(
	context: EnsureGitKitContext,
	reason = "module:git",
): Promise<GitKit> {
	const existingKit = context.getKit<GitKit>(GIT_KIT_ID);
	if (existingKit) {
		return existingKit;
	}

	return await context.runtime.attachKit(new GitKit(), { reason });
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

function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(numericValue) || numericValue < 1) {
		throw new InvalidParamsError(`${fieldName} must be a positive integer.`);
	}

	return numericValue;
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
		const values = value.map((entry, index) => parseRequiredString(entry, `${fieldName}[${index}]`));
		return values.length > 0 ? values : undefined;
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

function parseOptionalBooleanAliases(
	entries: readonly Array<{ fieldName: string; value: unknown }>,
): boolean | undefined {
	const resolvedEntries = entries
		.map((entry) => ({
			fieldName: entry.fieldName,
			value: parseOptionalBoolean(entry.value, entry.fieldName),
		}))
		.filter((entry) => entry.value !== undefined);

	if (resolvedEntries.length === 0) {
		return undefined;
	}

	const uniqueValues = new Set(resolvedEntries.map((entry) => entry.value));
	if (uniqueValues.size > 1) {
		throw new InvalidParamsError(
			`Conflicting boolean aliases provided: ${resolvedEntries.map((entry) => entry.fieldName).join(", ")}.`,
		);
	}

	return resolvedEntries[0]?.value;
}

function parseOptionalUntrackedFiles(
	value: unknown,
	fieldName: string,
): GitStatusOptions["untrackedFiles"] | undefined {
	const normalizedValue = parseOptionalString(value, fieldName);
	if (!normalizedValue) {
		return undefined;
	}

	if (normalizedValue === "all" || normalizedValue === "no" || normalizedValue === "normal") {
		return normalizedValue;
	}

	throw new InvalidParamsError(`${fieldName} must be one of: all, no, normal.`);
}

function normalizeGitCloneParams(params: GitCloneParams): { options: GitCloneOptions; repo: string } {
	return {
		options: {
			branch: parseOptionalString(params.branch, "branch"),
			cwd: parseOptionalString(params.cwd, "cwd"),
			depth: parseOptionalPositiveInteger(params.depth, "depth"),
			directory: parseOptionalString(params.directory, "directory"),
			quiet: parseOptionalBoolean(params.quiet, "quiet"),
			recurseSubmodules: parseOptionalBoolean(params.recurseSubmodules, "recurseSubmodules"),
			remoteName: parseOptionalString(params.remoteName, "remoteName"),
			shallowSubmodules: parseOptionalBoolean(params.shallowSubmodules, "shallowSubmodules"),
			singleBranch: parseOptionalBoolean(params.singleBranch, "singleBranch"),
		},
		repo: parseRequiredString(params.repo, "repo"),
	};
}

function normalizeGitInitParams(params: GitInitParams): GitInitOptions {
	return {
		bare: parseOptionalBoolean(params.bare, "bare"),
		branch: parseOptionalString(params.branch, "branch"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		path: parseOptionalString(params.path, "path"),
		quiet: parseOptionalBoolean(params.quiet, "quiet"),
	};
}

function normalizeGitStatusParams(params: GitStatusParams): GitStatusOptions {
	return {
		branch: parseOptionalBoolean(params.branch, "branch"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		showStash: parseOptionalBoolean(params.showStash, "showStash"),
		short: parseOptionalBoolean(params.short, "short"),
		untrackedFiles: parseOptionalUntrackedFiles(params.untrackedFiles, "untrackedFiles"),
	};
}

function normalizeGitBranchParams(params: GitBranchParams): GitBranchOptions {
	return {
		all: parseOptionalBoolean(params.all, "all"),
		contains: parseOptionalString(params.contains, "contains"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		format: parseOptionalString(params.format, "format"),
		merged: parseOptionalString(params.merged, "merged"),
		noMerged: parseOptionalString(params.noMerged, "noMerged"),
		remotes: parseOptionalBoolean(params.remotes, "remotes"),
		sort: parseOptionalString(params.sort, "sort"),
		verbose: parseOptionalBoolean(params.verbose, "verbose"),
	};
}

function normalizeGitLogParams(params: GitLogParams): GitLogOptions {
	return {
		author: parseOptionalString(params.author, "author"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		format: parseOptionalString(params.format, "format"),
		grep: parseOptionalString(params.grep, "grep"),
		maxCount: parseOptionalPositiveInteger(params.maxCount, "maxCount"),
		oneline: parseOptionalBoolean(params.oneline, "oneline"),
		paths: parseOptionalStringArray(params.paths, "paths"),
		ref: parseOptionalString(params.ref, "ref"),
		stat: parseOptionalBoolean(params.stat, "stat"),
	};
}

function normalizeGitDiffParams(params: GitDiffParams): GitDiffOptions {
	return {
		base: parseOptionalString(params.base, "base"),
		cached: parseOptionalBooleanAliases([
			{ fieldName: "cached", value: params.cached },
			{ fieldName: "staged", value: params.staged },
		]),
		cwd: parseOptionalString(params.cwd, "cwd"),
		head: parseOptionalString(params.head, "head"),
		nameOnly: parseOptionalBoolean(params.nameOnly, "nameOnly"),
		paths: parseOptionalStringArray(params.paths, "paths"),
		stat: parseOptionalBoolean(params.stat, "stat"),
	};
}

function normalizeGitAddParams(params: GitAddParams): GitAddOptions {
	const options: GitAddOptions = {
		all: parseOptionalBoolean(params.all, "all"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		force: parseOptionalBoolean(params.force, "force"),
		paths: parseOptionalStringArray(params.paths, "paths"),
		update: parseOptionalBoolean(params.update, "update"),
		verbose: parseOptionalBoolean(params.verbose, "verbose"),
	};

	if ((!options.paths || options.paths.length === 0) && !options.all && !options.update) {
		throw new InvalidParamsError("git.add requires either paths, all=true, or update=true.");
	}

	return options;
}

function normalizeGitCommitParams(params: GitCommitParams): GitCommitOptions {
	return {
		all: parseOptionalBoolean(params.all, "all"),
		allowEmpty: parseOptionalBoolean(params.allowEmpty, "allowEmpty"),
		author: parseOptionalString(params.author, "author"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		message: parseRequiredString(params.message, "message"),
		noVerify: parseOptionalBoolean(params.noVerify, "noVerify"),
	};
	}

function normalizeGitRestoreParams(params: GitRestoreParams): GitRestoreOptions {
	return {
		cwd: parseOptionalString(params.cwd, "cwd"),
		paths: parseRequiredStringArray(params.paths, "paths"),
		source: parseOptionalString(params.source, "source"),
		staged: parseOptionalBoolean(params.staged, "staged"),
		worktree: parseOptionalBoolean(params.worktree, "worktree"),
	};
}

function normalizeGitFetchParams(params: GitFetchParams): GitFetchOptions {
	return {
		all: parseOptionalBoolean(params.all, "all"),
		branch: parseOptionalString(params.branch, "branch"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		depth: parseOptionalPositiveInteger(params.depth, "depth"),
		prune: parseOptionalBoolean(params.prune, "prune"),
		remote: parseOptionalString(params.remote, "remote"),
		tags: parseOptionalBoolean(params.tags, "tags"),
	};
}

function normalizeGitPullParams(params: GitPullParams): GitPullOptions {
	return {
		branch: parseOptionalString(params.branch, "branch"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		ffOnly: parseOptionalBoolean(params.ffOnly, "ffOnly"),
		prune: parseOptionalBoolean(params.prune, "prune"),
		rebase: parseOptionalBoolean(params.rebase, "rebase"),
		remote: parseOptionalString(params.remote, "remote"),
	};
}

function normalizeGitPushParams(params: GitPushParams): GitPushOptions {
	return {
		branch: parseOptionalString(params.branch, "branch"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		force: parseOptionalBoolean(params.force, "force"),
		remote: parseOptionalString(params.remote, "remote"),
		setUpstream: parseOptionalBoolean(params.setUpstream, "setUpstream"),
		tags: parseOptionalBoolean(params.tags, "tags"),
	};
}

function normalizeGitCheckoutParams(params: GitCheckoutParams): GitCheckoutOptions {
	return {
		cwd: parseOptionalString(params.cwd, "cwd"),
		detach: parseOptionalBoolean(params.detach, "detach"),
		ref: parseRequiredString(params.ref, "ref"),
	};
}

function normalizeGitSwitchParams(params: GitSwitchParams): GitSwitchOptions {
	return {
		cwd: parseOptionalString(params.cwd, "cwd"),
		detach: parseOptionalBoolean(params.detach, "detach"),
		target: parseRequiredString(params.target, "target"),
	};
}

function normalizeGitBranchCreateParams(params: GitBranchCreateParams): GitBranchCreateOptions {
	return {
		cwd: parseOptionalString(params.cwd, "cwd"),
		name: parseRequiredString(params.name, "name"),
		startPoint: parseOptionalString(params.startPoint, "startPoint"),
	};
}

function normalizeGitBranchDeleteParams(params: GitBranchDeleteParams): GitBranchDeleteOptions {
	return {
		cwd: parseOptionalString(params.cwd, "cwd"),
		force: parseOptionalBoolean(params.force, "force"),
		name: parseRequiredString(params.name, "name"),
	};
}

function normalizeGitMergeParams(params: GitMergeParams): GitMergeOptions {
	return {
		cwd: parseOptionalString(params.cwd, "cwd"),
		ffOnly: parseOptionalBoolean(params.ffOnly, "ffOnly"),
		message: parseOptionalString(params.message, "message"),
		noCommit: parseOptionalBoolean(params.noCommit, "noCommit"),
		noFf: parseOptionalBoolean(params.noFf, "noFf"),
		ref: parseRequiredString(params.ref, "ref"),
		squash: parseOptionalBoolean(params.squash, "squash"),
	};
}

function normalizeGitRebaseParams(params: GitRebaseParams): GitRebaseOptions {
	return {
		autostash: parseOptionalBoolean(params.autostash, "autostash"),
		branch: parseOptionalString(params.branch, "branch"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		onto: parseOptionalString(params.onto, "onto"),
		upstream: parseRequiredString(params.upstream, "upstream"),
	};
}

function normalizeGitTagParams(params: GitTagParams): GitTagOptions {
	return {
		contains: parseOptionalString(params.contains, "contains"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		format: parseOptionalString(params.format, "format"),
		merged: parseOptionalString(params.merged, "merged"),
		noMerged: parseOptionalString(params.noMerged, "noMerged"),
		pointsAt: parseOptionalString(params.pointsAt, "pointsAt"),
		sort: parseOptionalString(params.sort, "sort"),
	};
}

function normalizeGitTagCreateParams(params: GitTagCreateParams): GitTagCreateOptions {
	return {
		annotate: parseOptionalBoolean(params.annotate, "annotate"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		force: parseOptionalBoolean(params.force, "force"),
		message: parseOptionalString(params.message, "message"),
		name: parseRequiredString(params.name, "name"),
		ref: parseOptionalString(params.ref, "ref"),
	};
}

function normalizeGitTagDeleteParams(params: GitTagDeleteParams): GitTagDeleteOptions {
	return {
		cwd: parseOptionalString(params.cwd, "cwd"),
		name: parseRequiredString(params.name, "name"),
	};
}

const GIT_COMMON_CONSOLE_PARAMS = [
	{ name: "cwd", detail: "Optional logical path inside data/ used as the real working directory", example: "/", valueType: "string" },
] as const;

const GIT_CD_CONSOLE_PARAMS = [
	{ name: "path", detail: "Logical directory inside data/", example: "/repos/demo", valueType: "string", required: true },
] as const;

export const gitPwdModule = defineModule<undefined, GitPwdResult>({
	id: "git/pwd",
	category: "git",
	description: "Show the current Git real-filesystem working directory inside data/",
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/pwd");
		return await kit.pwd();
	}),
});

export const gitCdModule = defineModule<GitCdParams, GitWorkingDirectory>({
	id: "git/cd",
	category: "git",
	description: "Change the current Git real-filesystem working directory inside data/",
	consoleParams: GIT_CD_CONSOLE_PARAMS,
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/cd");
		return await kit.cd(parseRequiredString(context.params.path, "path"));
	}),
}).useDefault("path");

export const gitCloneModule = defineModule<GitCloneParams, GitCommandResult>({
	id: "git/clone",
	category: "git",
	description: "Run git clone in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "repo", detail: "Repository URL or local source path", example: "https://github.com/example/repo.git", valueType: "string", required: true },
		{ name: "directory", detail: "Optional target directory inside data/", example: "/repos/repo", valueType: "string" },
		{ name: "branch", detail: "Optional branch to check out after clone", example: "main", valueType: "string" },
		{ name: "depth", detail: "Optional shallow clone depth", example: "1", valueType: "number" },
		{ name: "recurseSubmodules", detail: "Clone submodules after the main repository", valueType: "boolean" },
		{ name: "shallowSubmodules", detail: "Clone submodules shallowly when used with recurseSubmodules", valueType: "boolean" },
		{ name: "singleBranch", detail: "Clone only the chosen branch history", valueType: "boolean" },
		{ name: "remoteName", detail: "Optional remote name instead of origin", example: "upstream", valueType: "string" },
		{ name: "quiet", detail: "Suppress progress output", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/clone");
		const normalized = normalizeGitCloneParams(context.params);
		return await kit.clone(normalized.repo, normalized.options);
	}),
}).useDefault("repo");

export const gitInitModule = defineModule<GitInitParams, GitCommandResult>({
	id: "git/init",
	category: "git",
	description: "Run git init in the current Git working directory or for a target path inside data/",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "path", detail: "Optional target directory inside data/ to initialize", example: "/repos/demo", valueType: "string" },
		{ name: "branch", detail: "Optional initial branch name", example: "main", valueType: "string" },
		{ name: "bare", detail: "Create a bare repository", valueType: "boolean" },
		{ name: "quiet", detail: "Suppress init output", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/init");
		return await kit.init(normalizeGitInitParams(context.params));
	}),
});

export const gitStatusModule = defineModule<GitStatusParams, GitCommandResult>({
	id: "git/status",
	category: "git",
	description: "Run git status in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "short", detail: "Use the short status format", valueType: "boolean" },
		{ name: "branch", detail: "Show branch and tracking information", valueType: "boolean" },
		{ name: "showStash", detail: "Display stash count in the status header", valueType: "boolean" },
		{ name: "untrackedFiles", detail: "Control how untracked files are shown", values: ["all", "normal", "no"], example: "normal", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/status");
		return await kit.status(normalizeGitStatusParams(context.params));
	}),
});

export const gitBranchModule = defineModule<GitBranchParams, GitCommandResult>({
	id: "git/branch",
	category: "git",
	description: "List branches in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "all", detail: "Show both local and remote-tracking branches", valueType: "boolean" },
		{ name: "remotes", detail: "Show remote-tracking branches only", valueType: "boolean" },
		{ name: "verbose", detail: "Show commit and tracking information for each branch", valueType: "boolean" },
		{ name: "contains", detail: "Only show branches containing the given commit", example: "HEAD", valueType: "string" },
		{ name: "merged", detail: "Only show branches merged into the given commit", example: "main", valueType: "string" },
		{ name: "noMerged", detail: "Only show branches not yet merged into the given commit", example: "main", valueType: "string" },
		{ name: "sort", detail: "Sort key for branch output", example: "-committerdate", valueType: "string" },
		{ name: "format", detail: "Custom output format string", example: "%(refname:short) %(objectname:short)", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/branch");
		return await kit.branch(normalizeGitBranchParams(context.params));
	}),
});

export const gitLogModule = defineModule<GitLogParams, GitCommandResult>({
	id: "git/log",
	category: "git",
	description: "Run git log in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "ref", detail: "Optional revision or ref to inspect", example: "HEAD", valueType: "string" },
		{ name: "paths", detail: "Optional path filters as a comma-separated string or array", example: "src,index.ts", valueType: "string[]" },
		{ name: "maxCount", detail: "Maximum number of commits to show", example: "20", valueType: "number" },
		{ name: "oneline", detail: "Use the one-line commit format", valueType: "boolean" },
		{ name: "stat", detail: "Show changed file statistics per commit", valueType: "boolean" },
		{ name: "author", detail: "Only include commits by matching author", example: "john", valueType: "string" },
		{ name: "grep", detail: "Only include commits matching this message pattern", example: "fix", valueType: "string" },
		{ name: "format", detail: "Custom pretty-format string", example: "%H %s", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/log");
		return await kit.log(normalizeGitLogParams(context.params));
	}),
});

export const gitDiffModule = defineModule<GitDiffParams, GitCommandResult>({
	id: "git/diff",
	category: "git",
	description: "Run git diff in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "base", detail: "Optional base revision", example: "HEAD~1", valueType: "string" },
		{ name: "head", detail: "Optional head revision", example: "HEAD", valueType: "string" },
		{ name: "paths", detail: "Optional path filters as a comma-separated string or array", example: "src,index.ts", valueType: "string[]" },
		{ name: "cached", detail: "Diff staged changes instead of the working tree", valueType: "boolean" },
		{ name: "staged", detail: "Alias for cached", valueType: "boolean" },
		{ name: "nameOnly", detail: "Only list changed file names", valueType: "boolean" },
		{ name: "stat", detail: "Show diffstat output", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/diff");
		return await kit.diff(normalizeGitDiffParams(context.params));
	}),
});

export const gitAddModule = defineModule<GitAddParams, GitCommandResult>({
	id: "git/add",
	category: "git",
	description: "Run git add in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "paths", detail: "Pathspecs as a comma-separated string or array", example: "README.md,src", valueType: "string[]" },
		{ name: "all", detail: "Stage all tracked and untracked changes", valueType: "boolean" },
		{ name: "update", detail: "Stage modifications and deletions to tracked files only", valueType: "boolean" },
		{ name: "force", detail: "Allow adding otherwise ignored files", valueType: "boolean" },
		{ name: "verbose", detail: "Show verbose staging output", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/add");
		return await kit.add(normalizeGitAddParams(context.params));
	}),
});

export const gitCommitModule = defineModule<GitCommitParams, GitCommandResult>({
	id: "git/commit",
	category: "git",
	description: "Run git commit in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "message", detail: "Commit message", example: "feat: add api", valueType: "string", required: true },
		{ name: "all", detail: "Automatically stage tracked file modifications before commit", valueType: "boolean" },
		{ name: "allowEmpty", detail: "Allow creating an empty commit", valueType: "boolean" },
		{ name: "author", detail: "Override the commit author", example: "Jane Doe <jane@example.com>", valueType: "string" },
		{ name: "noVerify", detail: "Skip commit hooks", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/commit");
		return await kit.commit(normalizeGitCommitParams(context.params));
	}),
}).useDefault("message");

export const gitRestoreModule = defineModule<GitRestoreParams, GitCommandResult>({
	id: "git/restore",
	category: "git",
	description: "Run git restore in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "paths", detail: "Pathspecs to restore as a comma-separated string or array", example: "README.md,src/index.ts", valueType: "string[]", required: true },
		{ name: "source", detail: "Optional treeish to restore from", example: "HEAD", valueType: "string" },
		{ name: "staged", detail: "Restore the index copy instead of the working tree", valueType: "boolean" },
		{ name: "worktree", detail: "Restore the working tree explicitly", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/restore");
		return await kit.restore(normalizeGitRestoreParams(context.params));
	}),
}).useDefault("paths");

export const gitFetchModule = defineModule<GitFetchParams, GitCommandResult>({
	id: "git/fetch",
	category: "git",
	description: "Run git fetch in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "remote", detail: "Optional remote to fetch", example: "origin", valueType: "string" },
		{ name: "branch", detail: "Optional branch or refspec to fetch", example: "main", valueType: "string" },
		{ name: "all", detail: "Fetch all remotes", valueType: "boolean" },
		{ name: "prune", detail: "Prune deleted remote-tracking refs", valueType: "boolean" },
		{ name: "tags", detail: "Fetch all tags", valueType: "boolean" },
		{ name: "depth", detail: "Limit fetch depth", example: "1", valueType: "number" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/fetch");
		return await kit.fetch(normalizeGitFetchParams(context.params));
	}),
});

export const gitPullModule = defineModule<GitPullParams, GitCommandResult>({
	id: "git/pull",
	category: "git",
	description: "Run git pull in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "remote", detail: "Optional remote to pull from", example: "origin", valueType: "string" },
		{ name: "branch", detail: "Optional branch to pull", example: "main", valueType: "string" },
		{ name: "rebase", detail: "Rebase instead of merge when pulling", valueType: "boolean" },
		{ name: "ffOnly", detail: "Allow only fast-forward pulls", valueType: "boolean" },
		{ name: "prune", detail: "Prune deleted remote-tracking refs", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/pull");
		return await kit.pull(normalizeGitPullParams(context.params));
	}),
});

export const gitPushModule = defineModule<GitPushParams, GitCommandResult>({
	id: "git/push",
	category: "git",
	description: "Run git push in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "remote", detail: "Optional remote to push to", example: "origin", valueType: "string" },
		{ name: "branch", detail: "Optional branch or refspec to push", example: "main", valueType: "string" },
		{ name: "force", detail: "Force the push", valueType: "boolean" },
		{ name: "setUpstream", detail: "Set the upstream tracking reference on push", valueType: "boolean" },
		{ name: "tags", detail: "Push all tags", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/push");
		return await kit.push(normalizeGitPushParams(context.params));
	}),
});

export const gitCheckoutModule = defineModule<GitCheckoutParams, GitCommandResult>({
	id: "git/checkout",
	category: "git",
	description: "Run git checkout in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "ref", detail: "Branch, tag, or commit to check out", example: "main", valueType: "string", required: true },
		{ name: "detach", detail: "Detach HEAD at the target ref", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/checkout");
		return await kit.checkout(normalizeGitCheckoutParams(context.params));
	}),
}).useDefault("ref");

export const gitSwitchModule = defineModule<GitSwitchParams, GitCommandResult>({
	id: "git/switch",
	category: "git",
	description: "Run git switch in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "target", detail: "Branch or commit to switch to", example: "main", valueType: "string", required: true },
		{ name: "detach", detail: "Detach HEAD at the target instead of switching a branch", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/switch");
		return await kit.switch(normalizeGitSwitchParams(context.params));
	}),
}).useDefault("target");

export const gitBranchCreateModule = defineModule<GitBranchCreateParams, GitCommandResult>({
	id: "git/branch/create",
	category: "git",
	description: "Create a branch in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "name", detail: "New branch name", example: "feature/api", valueType: "string", required: true },
		{ name: "startPoint", detail: "Optional starting ref for the new branch", example: "main", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/branch/create");
		return await kit.createBranch(normalizeGitBranchCreateParams(context.params));
	}),
}).useDefault("name");

export const gitBranchDeleteModule = defineModule<GitBranchDeleteParams, GitCommandResult>({
	id: "git/branch/delete",
	category: "git",
	description: "Delete a branch in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "name", detail: "Branch name to delete", example: "feature/api", valueType: "string", required: true },
		{ name: "force", detail: "Force deletion even when the branch is not fully merged", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/branch/delete");
		return await kit.deleteBranch(normalizeGitBranchDeleteParams(context.params));
	}),
}).useDefault("name");

export const gitMergeModule = defineModule<GitMergeParams, GitCommandResult>({
	id: "git/merge",
	category: "git",
	description: "Run git merge in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "ref", detail: "Branch or commit to merge", example: "feature/api", valueType: "string", required: true },
		{ name: "ffOnly", detail: "Allow only fast-forward merges", valueType: "boolean" },
		{ name: "noFf", detail: "Create a merge commit even when fast-forward is possible", valueType: "boolean" },
		{ name: "noCommit", detail: "Stop before creating the merge commit", valueType: "boolean" },
		{ name: "squash", detail: "Produce the working tree/index state without creating a merge commit", valueType: "boolean" },
		{ name: "message", detail: "Merge commit message override", example: "Merge feature/api", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/merge");
		return await kit.merge(normalizeGitMergeParams(context.params));
	}),
}).useDefault("ref");

export const gitRebaseModule = defineModule<GitRebaseParams, GitCommandResult>({
	id: "git/rebase",
	category: "git",
	description: "Run git rebase in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "upstream", detail: "Upstream branch or commit to rebase onto", example: "main", valueType: "string", required: true },
		{ name: "branch", detail: "Optional branch to rebase instead of the current HEAD", example: "feature/api", valueType: "string" },
		{ name: "onto", detail: "Optional new base for the rebased commits", example: "origin/main", valueType: "string" },
		{ name: "autostash", detail: "Automatically stash and restore local changes around the rebase", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/rebase");
		return await kit.rebase(normalizeGitRebaseParams(context.params));
	}),
}).useDefault("upstream");

export const gitTagModule = defineModule<GitTagParams, GitCommandResult>({
	id: "git/tag",
	category: "git",
	description: "List tags in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "contains", detail: "Only show tags containing the given commit", example: "HEAD", valueType: "string" },
		{ name: "pointsAt", detail: "Only show tags pointing at the given object", example: "HEAD", valueType: "string" },
		{ name: "merged", detail: "Only show tags merged into the given commit", example: "main", valueType: "string" },
		{ name: "noMerged", detail: "Only show tags not merged into the given commit", example: "main", valueType: "string" },
		{ name: "sort", detail: "Sort key for tag output", example: "-creatordate", valueType: "string" },
		{ name: "format", detail: "Custom output format string", example: "%(refname:short)", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/tag");
		return await kit.tag(normalizeGitTagParams(context.params));
	}),
});

export const gitTagCreateModule = defineModule<GitTagCreateParams, GitCommandResult>({
	id: "git/tag/create",
	category: "git",
	description: "Create a tag in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "name", detail: "Tag name", example: "v1.0.0", valueType: "string", required: true },
		{ name: "ref", detail: "Optional ref to tag; defaults to HEAD", example: "main", valueType: "string" },
		{ name: "annotate", detail: "Create an annotated tag", valueType: "boolean" },
		{ name: "message", detail: "Optional tag message; implies an annotated tag", example: "release 1.0.0", valueType: "string" },
		{ name: "force", detail: "Replace an existing tag", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/tag/create");
		return await kit.createTag(normalizeGitTagCreateParams(context.params));
	}),
}).useDefault("name");

export const gitTagDeleteModule = defineModule<GitTagDeleteParams, GitCommandResult>({
	id: "git/tag/delete",
	category: "git",
	description: "Delete a tag in the current Git working directory",
	consoleParams: [
		...GIT_COMMON_CONSOLE_PARAMS,
		{ name: "name", detail: "Tag name to delete", example: "v1.0.0", valueType: "string", required: true },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureGitKit(context, "module:git/tag/delete");
		return await kit.deleteTag(normalizeGitTagDeleteParams(context.params));
	}),
}).useDefault("name");