import {
	DOCKER_KIT_ID,
	DockerKit,
	type DockerBuildOptions,
	type DockerCommandResult,
	type DockerComposeDownOptions,
	type DockerComposeLogsOptions,
	type DockerComposeLogsTail,
	type DockerComposePsOptions,
	type DockerComposePullOptions,
	type DockerComposeRestartOptions,
	type DockerComposeUpOptions,
	type DockerExecOptions,
	type DockerImagesOptions,
	type DockerInspectOptions,
	type DockerPsOptions,
	type DockerPullOptions,
	type DockerRunOptions,
	type DockerWorkingDirectory,
} from "../kits";
import { createTableEntity, createTextEntity, type OutputEntity } from "../primitives";
import { InvalidParamsError } from "./errors";
import { defineExecutor, defineModule, type ModuleExecutionContext } from "./module";

type EnsureDockerKitContext = Pick<ModuleExecutionContext<unknown, object>, "getKit" | "runtime">;

export type DockerCdParams = {
	path?: string;
};

export type DockerPwdResult = DockerWorkingDirectory;

export type DockerPullParams = DockerPullOptions & {
	image?: string;
};

export type DockerPsParams = DockerPsOptions & {
	filter?: readonly string[] | string;
};

type DockerPsCommandResult = DockerCommandResult & {
	parsed?: OutputEntity[];
};

export type DockerImagesParams = DockerImagesOptions & {
	filter?: readonly string[] | string;
};

export type DockerInspectParams = DockerInspectOptions & {
	targets?: readonly string[] | string;
};

export type DockerBuildParams = Omit<DockerBuildOptions, "buildArgs" | "tags"> & {
	buildArgs?: readonly string[] | string;
	tags?: readonly string[] | string;
};

export type DockerRunParams = Omit<DockerRunOptions, "command" | "detach"> & {
	command?: readonly string[] | string;
	deattach?: boolean;
	detach?: boolean;
	detached?: boolean;
	env?: readonly string[] | string;
	image?: string;
	ports?: readonly string[] | string;
};

export type DockerExecParams = Omit<DockerExecOptions, "detach"> & {
	command?: readonly string[] | string;
	container?: string;
	deattach?: boolean;
	detach?: boolean;
	detached?: boolean;
	env?: readonly string[] | string;
};

export type DockerComposePullParams = DockerComposePullOptions & {
	services?: readonly string[] | string;
};

export type DockerComposeUpParams = Omit<DockerComposeUpOptions, "detach" | "services"> & {
	deattach?: boolean;
	detach?: boolean;
	detached?: boolean;
	services?: readonly string[] | string;
};

export type DockerComposeDownParams = DockerComposeDownOptions;

export type DockerComposePsParams = DockerComposePsOptions & {
	services?: readonly string[] | string;
};

export type DockerComposeRestartParams = DockerComposeRestartOptions & {
	services?: readonly string[] | string;
};

export type DockerComposeLogsParams = Omit<DockerComposeLogsOptions, "services" | "tail"> & {
	services?: readonly string[] | string;
	tail?: DockerComposeLogsTail | string;
};

async function ensureDockerKit(
	context: EnsureDockerKitContext,
	reason = "module:docker",
): Promise<DockerKit> {
	const existingKit = context.getKit<DockerKit>(DOCKER_KIT_ID);
	if (existingKit) {
		return existingKit;
	}

	return await context.runtime.attachKit(new DockerKit(), { reason });
}

const DOCKER_PS_JSON_FORMAT = "{{json .}}";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatDockerPsField(value: unknown): string {
	if (typeof value === "string") {
		return value.trim();
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	if (isObjectRecord(value) || Array.isArray(value)) {
		return JSON.stringify(value);
	}

	return "";
}

function formatDockerPsCommand(value: unknown): string {
	const command = formatDockerPsField(value);
	if (command.length >= 2 && command.startsWith('"') && command.endsWith('"')) {
		return command.slice(1, -1);
	}

	return command;
}

function parseDockerPsJsonOutput(stdout: string): Record<string, unknown>[] {
	const containers: Record<string, unknown>[] = [];

	for (const line of stdout.split(/\r?\n/u)) {
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			continue;
		}

		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (isObjectRecord(parsed)) {
				containers.push(parsed);
			}
		} catch {
			return [];
		}
	}

	return containers;
}

function buildDockerPsStructuredOutput(
	containers: readonly Record<string, unknown>[],
	options: DockerPsOptions,
): OutputEntity[] {
	if (containers.length === 0) {
		return [
			createTextEntity(options.all ? "No containers found." : "No running containers found.", {
				title: "Containers",
				tone: "muted",
			}),
		];
	}

	return [
		createTableEntity(
			[
				{ key: "name", header: "Name" },
				{ key: "image", header: "Image" },
				{ key: "status", header: "Status" },
				{ key: "ports", header: "Ports" },
				{ key: "command", header: "Command" },
				{ key: "id", header: "ID" },
			],
			containers.map((container) => ({
				command: formatDockerPsCommand(container.Command) || "-",
				id: formatDockerPsField(container.ID) || "-",
				image: formatDockerPsField(container.Image) || "-",
				name: formatDockerPsField(container.Names) || "-",
				ports: formatDockerPsField(container.Ports) || "-",
				status: formatDockerPsField(container.Status) || formatDockerPsField(container.State) || "-",
			})),
			{ title: `Containers (${containers.length})` },
		),
	];
}

async function parseDockerPsStructuredOutput(
	kit: DockerKit,
	options: DockerPsOptions,
): Promise<OutputEntity[] | undefined> {
	if (typeof options.format === "string" && options.format.length > 0) {
		return undefined;
	}

	try {
		const structuredResult = await kit.ps({
			...options,
			format: DOCKER_PS_JSON_FORMAT,
			quiet: undefined,
		});
		const containers = parseDockerPsJsonOutput(structuredResult.stdout);
		return buildDockerPsStructuredOutput(containers, options);
	} catch {
		return undefined;
	}
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

function parseOptionalTail(value: unknown, fieldName: string): DockerComposeLogsTail | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value === "string" && value.trim().toLowerCase() === "all") {
		return "all";
	}

	return parseOptionalPositiveInteger(value, fieldName);
}

function parseBooleanAliases(
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

function normalizeDockerPullParams(params: DockerPullParams): { image: string; options: DockerPullOptions } {
	return {
		image: parseRequiredString(params.image, "image"),
		options: {
			allTags: parseOptionalBoolean(params.allTags, "allTags"),
			cwd: parseOptionalString(params.cwd, "cwd"),
			platform: parseOptionalString(params.platform, "platform"),
			quiet: parseOptionalBoolean(params.quiet, "quiet"),
		},
	};
}

function normalizeDockerPsParams(params: DockerPsParams): DockerPsOptions {
	return {
		all: parseOptionalBoolean(params.all, "all"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		filter: parseOptionalStringArray(params.filter, "filter"),
		format: parseOptionalString(params.format, "format"),
		noTrunc: parseOptionalBoolean(params.noTrunc, "noTrunc"),
		quiet: parseOptionalBoolean(params.quiet, "quiet"),
		size: parseOptionalBoolean(params.size, "size"),
	};
}

function normalizeDockerImagesParams(params: DockerImagesParams): DockerImagesOptions {
	return {
		all: parseOptionalBoolean(params.all, "all"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		digests: parseOptionalBoolean(params.digests, "digests"),
		filter: parseOptionalStringArray(params.filter, "filter"),
		format: parseOptionalString(params.format, "format"),
		noTrunc: parseOptionalBoolean(params.noTrunc, "noTrunc"),
		quiet: parseOptionalBoolean(params.quiet, "quiet"),
	};
}

function normalizeDockerInspectParams(
	params: DockerInspectParams,
): { options: DockerInspectOptions; targets: readonly string[] } {
	return {
		options: {
			cwd: parseOptionalString(params.cwd, "cwd"),
			format: parseOptionalString(params.format, "format"),
			size: parseOptionalBoolean(params.size, "size"),
			type: parseOptionalString(params.type, "type"),
		},
		targets: parseRequiredStringArray(params.targets, "targets"),
	};
	}

function normalizeDockerBuildParams(params: DockerBuildParams): DockerBuildOptions {
	return {
		buildArgs: parseOptionalStringArray(params.buildArgs, "buildArgs"),
		context: parseOptionalString(params.context, "context"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		dockerfile: parseOptionalString(params.dockerfile, "dockerfile"),
		noCache: parseOptionalBoolean(params.noCache, "noCache"),
		platform: parseOptionalString(params.platform, "platform"),
		pull: parseOptionalBoolean(params.pull, "pull"),
		quiet: parseOptionalBoolean(params.quiet, "quiet"),
		tags: parseOptionalStringArray(params.tags, "tags"),
		target: parseOptionalString(params.target, "target"),
	};
}

function normalizeDockerRunParams(params: DockerRunParams): { image: string; options: DockerRunOptions } {
	return {
		image: parseRequiredString(params.image, "image"),
		options: {
			command: parseOptionalStringArray(params.command, "command"),
			cwd: parseOptionalString(params.cwd, "cwd"),
			detach: parseBooleanAliases([
				{ fieldName: "detach", value: params.detach },
				{ fieldName: "deattach", value: params.deattach },
				{ fieldName: "detached", value: params.detached },
			]),
			env: parseOptionalStringArray(params.env, "env"),
			name: parseOptionalString(params.name, "name"),
			network: parseOptionalString(params.network, "network"),
			ports: parseOptionalStringArray(params.ports, "ports"),
			publishAll: parseOptionalBoolean(params.publishAll, "publishAll"),
			remove: parseOptionalBoolean(params.remove, "remove"),
			workdir: parseOptionalString(params.workdir, "workdir"),
		},
	};
}

function normalizeDockerExecParams(
	params: DockerExecParams,
): { command: readonly string[]; container: string; options: DockerExecOptions } {
	return {
		command: parseRequiredStringArray(params.command, "command"),
		container: parseRequiredString(params.container, "container"),
		options: {
			cwd: parseOptionalString(params.cwd, "cwd"),
			detach: parseBooleanAliases([
				{ fieldName: "detach", value: params.detach },
				{ fieldName: "deattach", value: params.deattach },
				{ fieldName: "detached", value: params.detached },
			]),
			env: parseOptionalStringArray(params.env, "env"),
			user: parseOptionalString(params.user, "user"),
			workdir: parseOptionalString(params.workdir, "workdir"),
		},
	};
}

function normalizeComposePullParams(params: DockerComposePullParams): DockerComposePullOptions {
	return {
		cwd: parseOptionalString(params.cwd, "cwd"),
		ignoreBuildable: parseOptionalBoolean(params.ignoreBuildable, "ignoreBuildable"),
		includeDeps: parseOptionalBoolean(params.includeDeps, "includeDeps"),
		quiet: parseOptionalBoolean(params.quiet, "quiet"),
		services: parseOptionalStringArray(params.services, "services"),
	};
}

function normalizeComposeUpParams(params: DockerComposeUpParams): DockerComposeUpOptions {
	return {
		build: parseOptionalBoolean(params.build, "build"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		detach: parseBooleanAliases([
			{ fieldName: "detach", value: params.detach },
			{ fieldName: "deattach", value: params.deattach },
			{ fieldName: "detached", value: params.detached },
		]),
		forceRecreate: parseOptionalBoolean(params.forceRecreate, "forceRecreate"),
		removeOrphans: parseOptionalBoolean(params.removeOrphans, "removeOrphans"),
		services: parseOptionalStringArray(params.services, "services"),
		wait: parseOptionalBoolean(params.wait, "wait"),
	};
}

function normalizeComposeDownParams(params: DockerComposeDownParams): DockerComposeDownOptions {
	const images = parseOptionalString(params.images, "images");
	if (images && images !== "all" && images !== "local") {
		throw new InvalidParamsError("images must be either 'all' or 'local'.");
	}

	return {
		cwd: parseOptionalString(params.cwd, "cwd"),
		images: images as DockerComposeDownOptions["images"],
		removeOrphans: parseOptionalBoolean(params.removeOrphans, "removeOrphans"),
		timeout: parseOptionalPositiveInteger(params.timeout, "timeout"),
		volumes: parseOptionalBoolean(params.volumes, "volumes"),
	};
}

function normalizeComposePsParams(params: DockerComposePsParams): DockerComposePsOptions {
	return {
		all: parseOptionalBoolean(params.all, "all"),
		cwd: parseOptionalString(params.cwd, "cwd"),
		services: parseOptionalStringArray(params.services, "services"),
	};
}

function normalizeComposeRestartParams(params: DockerComposeRestartParams): DockerComposeRestartOptions {
	return {
		cwd: parseOptionalString(params.cwd, "cwd"),
		services: parseOptionalStringArray(params.services, "services"),
		timeout: parseOptionalPositiveInteger(params.timeout, "timeout"),
	};
}

function normalizeComposeLogsParams(params: DockerComposeLogsParams): DockerComposeLogsOptions {
	return {
		cwd: parseOptionalString(params.cwd, "cwd"),
		noColor: parseOptionalBoolean(params.noColor, "noColor"),
		services: parseOptionalStringArray(params.services, "services"),
		since: parseOptionalString(params.since, "since"),
		tail: parseOptionalTail(params.tail, "tail"),
		timestamps: parseOptionalBoolean(params.timestamps, "timestamps"),
	};
}

const DOCKER_PULL_CONSOLE_PARAMS = [
	{ name: "image", detail: "Image reference to pull", example: "nginx:latest", valueType: "string" },
	{ name: "cwd", detail: "Optional logical path inside data/ used as the real working directory", example: "/", valueType: "string" },
	{ name: "platform", detail: "Optional target platform passed to docker pull", example: "linux/amd64", valueType: "string" },
	{ name: "allTags", detail: "Pull all tags for the repository", valueType: "boolean" },
	{ name: "quiet", detail: "Suppress verbose progress output", valueType: "boolean" },
] as const;

const DOCKER_CD_CONSOLE_PARAMS = [
	{ name: "path", detail: "Logical directory inside data/", example: "/cloudflare-radar/domains", valueType: "string", required: true },
] as const;

const DOCKER_COMPOSE_COMMON_CONSOLE_PARAMS = [
	{ name: "cwd", detail: "Optional logical path inside data/ used as the compose working directory", example: "/compose/demo", valueType: "string" },
	{ name: "services", detail: "Optional service names as a comma-separated string or array", example: "web,db", valueType: "string[]" },
] as const;

const DOCKER_COMMON_CONSOLE_PARAMS = [
	{ name: "cwd", detail: "Optional logical path inside data/ used as the real working directory", example: "/", valueType: "string" },
] as const;

const DOCKER_FILTER_CONSOLE_PARAMS = [
	{ name: "filter", detail: "Optional Docker filters as a comma-separated string or array", example: "status=running,label=app=web", valueType: "string[]" },
] as const;

export const dockerPwdModule = defineModule<undefined, DockerPwdResult>({
	id: "docker/pwd",
	category: "docker",
	description: "Show the current Docker real-filesystem working directory inside data/",
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/pwd");
		return await kit.pwd();
	}),
});

export const dockerCdModule = defineModule<DockerCdParams, DockerWorkingDirectory>({
	id: "docker/cd",
	category: "docker",
	description: "Change the current Docker real-filesystem working directory inside data/",
	consoleParams: DOCKER_CD_CONSOLE_PARAMS,
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/cd");
		return await kit.cd(parseRequiredString(context.params.path, "path"));
	}),
}).useDefault("path");

export const dockerPullModule = defineModule<DockerPullParams, DockerCommandResult>({
	id: "docker/pull",
	category: "docker",
	description: "Run docker pull in the current Docker working directory",
	consoleParams: DOCKER_PULL_CONSOLE_PARAMS,
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/pull");
		const normalized = normalizeDockerPullParams(context.params);
		return await kit.pull(normalized.image, normalized.options);
	}),
}).useDefault("image");

export const dockerPsModule = defineModule<DockerPsParams, DockerPsCommandResult>({
	id: "docker/ps",
	category: "docker",
	description: "Run docker ps in the current Docker working directory",
	consoleParams: [
		...DOCKER_COMMON_CONSOLE_PARAMS,
		...DOCKER_FILTER_CONSOLE_PARAMS,
		{ name: "all", detail: "Include stopped containers", valueType: "boolean" },
		{ name: "quiet", detail: "Only print numeric container IDs", valueType: "boolean" },
		{ name: "noTrunc", detail: "Do not truncate output", valueType: "boolean" },
		{ name: "size", detail: "Display total file sizes", valueType: "boolean" },
		{ name: "format", detail: "Go template format string for output", example: "table {{.ID}}\t{{.Image}}\t{{.Status}}", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/ps");
		const options = normalizeDockerPsParams(context.params);
		const result = await kit.ps(options);
		const parsed = await parseDockerPsStructuredOutput(kit, options);
		return parsed ? { ...result, parsed } : result;
	}),
});

export const dockerImagesModule = defineModule<DockerImagesParams, DockerCommandResult>({
	id: "docker/images",
	category: "docker",
	description: "Run docker images in the current Docker working directory",
	consoleParams: [
		...DOCKER_COMMON_CONSOLE_PARAMS,
		...DOCKER_FILTER_CONSOLE_PARAMS,
		{ name: "all", detail: "Show intermediate images", valueType: "boolean" },
		{ name: "quiet", detail: "Only print numeric image IDs", valueType: "boolean" },
		{ name: "noTrunc", detail: "Do not truncate output", valueType: "boolean" },
		{ name: "digests", detail: "Show image digests", valueType: "boolean" },
		{ name: "format", detail: "Go template format string for output", example: "table {{.Repository}}\t{{.Tag}}\t{{.ID}}", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/images");
		return await kit.images(normalizeDockerImagesParams(context.params));
	}),
});

export const dockerInspectModule = defineModule<DockerInspectParams, DockerCommandResult>({
	id: "docker/inspect",
	category: "docker",
	description: "Run docker inspect for one or more targets in the current Docker working directory",
	consoleParams: [
		...DOCKER_COMMON_CONSOLE_PARAMS,
		{ name: "targets", detail: "One or more container, image, volume, or network names or IDs", example: "web,redis:latest", valueType: "string[]", required: true },
		{ name: "type", detail: "Optional object type filter", example: "container", valueType: "string" },
		{ name: "size", detail: "Show total file sizes for containers", valueType: "boolean" },
		{ name: "format", detail: "Go template format string for output", example: "{{json .Config}}", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/inspect");
		const normalized = normalizeDockerInspectParams(context.params);
		return await kit.inspect(normalized.targets, normalized.options);
	}),
}).useDefault("targets");

export const dockerBuildModule = defineModule<DockerBuildParams, DockerCommandResult>({
	id: "docker/build",
	category: "docker",
	description: "Run docker build using a context rooted inside data/",
	consoleParams: [
		...DOCKER_COMMON_CONSOLE_PARAMS,
		{ name: "context", detail: "Logical build context path inside data/; defaults to the current Docker working directory", example: "/apps/api", valueType: "string" },
		{ name: "dockerfile", detail: "Optional Dockerfile path inside data/", example: "/apps/api/Dockerfile", valueType: "string" },
		{ name: "tags", detail: "Optional image tags as a comma-separated string or array", example: "local/api:dev,local/api:latest", valueType: "string[]" },
		{ name: "buildArgs", detail: "Optional build args as KEY=VALUE entries", example: "NODE_ENV=production,HTTP_PROXY=http://proxy:8080", valueType: "string[]" },
		{ name: "target", detail: "Optional target build stage", example: "runner", valueType: "string" },
		{ name: "platform", detail: "Optional target platform", example: "linux/amd64", valueType: "string" },
		{ name: "pull", detail: "Always attempt to pull newer base images", valueType: "boolean" },
		{ name: "noCache", detail: "Do not use cached layers", valueType: "boolean" },
		{ name: "quiet", detail: "Suppress verbose build output", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/build");
		return await kit.build(normalizeDockerBuildParams(context.params));
	}),
});

export const dockerRunModule = defineModule<DockerRunParams, DockerCommandResult>({
	id: "docker/run",
	category: "docker",
	description: "Run docker run in the current Docker working directory",
	consoleParams: [
		...DOCKER_COMMON_CONSOLE_PARAMS,
		{ name: "image", detail: "Image reference to run", example: "nginx:latest", valueType: "string", required: true },
		{ name: "command", detail: "Optional container command as a string or array", example: "[\"bun\",\"run\",\"start\"]", valueType: "string[]" },
		{ name: "detach", detail: "Run the container in the background", valueType: "boolean" },
		{ name: "remove", detail: "Automatically remove the container when it exits", valueType: "boolean" },
		{ name: "publishAll", detail: "Publish all exposed ports to random host ports", valueType: "boolean" },
		{ name: "ports", detail: "Port mappings as HOST:CONTAINER entries", example: "8080:80,127.0.0.1:2222:22", valueType: "string[]" },
		{ name: "env", detail: "Environment variables as KEY=VALUE entries", example: "NODE_ENV=production,DEBUG=0", valueType: "string[]" },
		{ name: "name", detail: "Optional container name", example: "iscan-api", valueType: "string" },
		{ name: "network", detail: "Optional Docker network", example: "bridge", valueType: "string" },
		{ name: "workdir", detail: "Container working directory", example: "/app", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/run");
		const normalized = normalizeDockerRunParams(context.params);
		return await kit.run(normalized.image, normalized.options);
	}),
}).useDefault("image");

export const dockerExecModule = defineModule<DockerExecParams, DockerCommandResult>({
	id: "docker/exec",
	category: "docker",
	description: "Run docker exec for a running container",
	consoleParams: [
		...DOCKER_COMMON_CONSOLE_PARAMS,
		{ name: "container", detail: "Container name or ID", example: "iscan-api", valueType: "string", required: true },
		{ name: "command", detail: "Command arguments as a string or array", example: "[\"sh\",\"-lc\",\"id\"]", valueType: "string[]", required: true },
		{ name: "detach", detail: "Run the exec command in the background", valueType: "boolean" },
		{ name: "env", detail: "Environment variables as KEY=VALUE entries", example: "TERM=xterm-256color", valueType: "string[]" },
		{ name: "user", detail: "Optional container user", example: "root", valueType: "string" },
		{ name: "workdir", detail: "Optional container working directory", example: "/app", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/exec");
		const normalized = normalizeDockerExecParams(context.params);
		return await kit.exec(normalized.container, normalized.command, normalized.options);
	}),
});

export const dockerComposePullModule = defineModule<DockerComposePullParams, DockerCommandResult>({
	id: "docker/compose/pull",
	category: "docker",
	description: "Run docker compose pull in the current Docker working directory",
	consoleParams: [
		...DOCKER_COMPOSE_COMMON_CONSOLE_PARAMS,
		{ name: "includeDeps", detail: "Also pull dependency services", valueType: "boolean" },
		{ name: "ignoreBuildable", detail: "Ignore services that can be built locally", valueType: "boolean" },
		{ name: "quiet", detail: "Suppress verbose progress output", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/compose/pull");
		return await kit.composePull(normalizeComposePullParams(context.params));
	}),
});

export const dockerComposeUpModule = defineModule<DockerComposeUpParams, DockerCommandResult>({
	id: "docker/compose/up",
	category: "docker",
	description: "Run docker compose up in the current Docker working directory",
	consoleParams: [
		...DOCKER_COMPOSE_COMMON_CONSOLE_PARAMS,
		{ name: "detach", detail: "Start services in the background", valueType: "boolean" },
		{ name: "build", detail: "Build images before starting containers", valueType: "boolean" },
		{ name: "forceRecreate", detail: "Recreate containers even when config has not changed", valueType: "boolean" },
		{ name: "removeOrphans", detail: "Remove containers for services not defined in the current compose file", valueType: "boolean" },
		{ name: "wait", detail: "Wait for services to become running or healthy", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/compose/up");
		return await kit.composeUp(normalizeComposeUpParams(context.params));
	}),
});

export const dockerComposeDownModule = defineModule<DockerComposeDownParams, DockerCommandResult>({
	id: "docker/compose/down",
	category: "docker",
	description: "Run docker compose down in the current Docker working directory",
	consoleParams: [
		{ name: "cwd", detail: "Optional logical path inside data/ used as the compose working directory", example: "/compose/demo", valueType: "string" },
		{ name: "removeOrphans", detail: "Remove containers for services not defined in the current compose file", valueType: "boolean" },
		{ name: "volumes", detail: "Remove named volumes declared in the compose file", valueType: "boolean" },
		{ name: "images", detail: "Remove images used by services", values: ["all", "local"], example: "local", valueType: "string" },
		{ name: "timeout", detail: "Shutdown timeout in seconds", example: "30", valueType: "number" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/compose/down");
		return await kit.composeDown(normalizeComposeDownParams(context.params));
	}),
});

export const dockerComposePsModule = defineModule<DockerComposePsParams, DockerCommandResult>({
	id: "docker/compose/ps",
	category: "docker",
	description: "Run docker compose ps in the current Docker working directory",
	consoleParams: [
		...DOCKER_COMPOSE_COMMON_CONSOLE_PARAMS,
		{ name: "all", detail: "Include stopped containers", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/compose/ps");
		return await kit.composePs(normalizeComposePsParams(context.params));
	}),
});

export const dockerComposeRestartModule = defineModule<DockerComposeRestartParams, DockerCommandResult>({
	id: "docker/compose/restart",
	category: "docker",
	description: "Run docker compose restart in the current Docker working directory",
	consoleParams: [
		...DOCKER_COMPOSE_COMMON_CONSOLE_PARAMS,
		{ name: "timeout", detail: "Restart timeout in seconds", example: "20", valueType: "number" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/compose/restart");
		return await kit.composeRestart(normalizeComposeRestartParams(context.params));
	}),
});

export const dockerComposeLogsModule = defineModule<DockerComposeLogsParams, DockerCommandResult>({
	id: "docker/compose/logs",
	category: "docker",
	description: "Run a non-follow docker compose logs snapshot in the current Docker working directory",
	consoleParams: [
		...DOCKER_COMPOSE_COMMON_CONSOLE_PARAMS,
		{ name: "tail", detail: "Number of lines to show, or 'all'", example: "200", valueType: "number" },
		{ name: "since", detail: "Only show logs since a timestamp or relative duration", example: "1h", valueType: "string" },
		{ name: "timestamps", detail: "Include timestamps in log output", valueType: "boolean" },
		{ name: "noColor", detail: "Disable ANSI color output", valueType: "boolean" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureDockerKit(context, "module:docker/compose/logs");
		return await kit.composeLogs(normalizeComposeLogsParams(context.params));
	}),
});