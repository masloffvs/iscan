import {
	createBpkgBindingConsoleParams,
	getBpkgBindingDefinition,
	registeredBpkgPackages,
	type BpkgBindingRuntimeBridge,
} from "../bpkg";
import {
	BPKG_KIT_ID,
	BpkgKit,
	parseBpkgSandboxPolicyExtensionsInput,
	type Kit,
	type BpkgBindingExecutionResult,
	type BpkgBoxRecord,
	type BpkgBoxPrivilegeConfig,
	type BpkgCommandResult,
	type BpkgInstallResult,
	type BpkgListResult,
	type BpkgPrivilegeLevel,
	type BpkgSandboxPolicyExtensionsInput,
	type BpkgSupportedPackageSummary,
} from "../kits";
import { InvalidParamsError } from "./errors";
import { defineExecutor, defineModule, type ModuleDefinition, type ModuleExecutionContext } from "./module";

type EnsureBpkgKitContext = Pick<ModuleExecutionContext<unknown, object>, "getKit" | "runtime">;

export type BpkgCreateParams = {
	allowedPrivilegeLevels?: readonly BpkgPrivilegeLevel[] | string;
	description?: string;
	defaultPrivilegeLevel?: BpkgPrivilegeLevel;
	id?: string;
	name?: string;
	packages?: readonly string[] | string;
	privilegeLevel?: BpkgPrivilegeLevel;
	sandboxPolicyExtensions?: BpkgSandboxPolicyExtensionsInput | string;
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
	privilegeLevel?: BpkgPrivilegeLevel;
};

export type BpkgPrivilegeGetParams = BpkgGetParams;

export type BpkgPrivilegeSetParams = {
	allowedPrivilegeLevels?: readonly BpkgPrivilegeLevel[] | string;
	boxId?: string;
	defaultPrivilegeLevel?: BpkgPrivilegeLevel;
	id?: string;
	privilegeLevel?: BpkgPrivilegeLevel;
	sandboxPolicyExtensions?: BpkgSandboxPolicyExtensionsInput | string;
	target?: string;
};

type NormalizedBpkgCreateParams = {
	allowedPrivilegeLevels?: readonly BpkgPrivilegeLevel[];
	description?: string;
	defaultPrivilegeLevel?: BpkgPrivilegeLevel;
	id: string;
	name?: string;
	packages?: readonly string[];
	sandboxPolicyExtensions?: BpkgSandboxPolicyExtensionsInput;
};

type NormalizedBpkgPrivilegeSetParams = {
	allowedPrivilegeLevels?: readonly BpkgPrivilegeLevel[];
	boxId?: string;
	defaultPrivilegeLevel?: BpkgPrivilegeLevel;
	sandboxPolicyExtensions?: BpkgSandboxPolicyExtensionsInput;
};

type YtdlpDslParams = Record<string, unknown>;
export type AtoolDslParams = Record<string, unknown>;

const YTDLP_PACKAGE_ID = "ytdlp";
const YTDLP_PACKAGE_ALIAS = "ydlp";
const ATOOL_PACKAGE_ID = "atool";
const BPKG_PRIVILEGE_LEVELS: readonly BpkgPrivilegeLevel[] = ["sandbox-ro", "sandbox-rw", "host-privileged"];

function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value !== "boolean") {
		throw new InvalidParamsError(`${fieldName} must be a boolean.`);
	}

	return value;
}

function parseOptionalNumber(value: unknown, fieldName: string): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numericValue)) {
		throw new InvalidParamsError(`${fieldName} must be a number.`);
	}

	return numericValue;
}

function parseBooleanFlag(record: Record<string, unknown>, fieldName: string): boolean {
	return record[fieldName] === true;
}

function readYtdlpTerminalActions(record: Record<string, unknown>): string[] {
	return ["download", "getInfo", "listFormats", "importCookies", "importCookiesFromCloakBrowser"]
		.filter((fieldName) => parseBooleanFlag(record, fieldName));
}

function normalizeYtdlpDslParams(params: unknown): { callback?: ((progress: unknown) => void) | undefined; config: Record<string, unknown> } {
	if (!isRecord(params)) {
		throw new InvalidParamsError("pkg/ytdlp expects object-style params or the JS chain form $.pkg.ydlp....");
	}

	const config: Record<string, unknown> = {};
	let callback: ((progress: unknown) => void) | undefined;
	const args = Array.isArray(params.args) ? params.args : [];

	for (const arg of args) {
		if (typeof arg === "function") {
			if (!callback) {
				callback = arg as (progress: unknown) => void;
			}
			continue;
		}

		if (isRecord(arg)) {
			Object.assign(config, arg);
		}
	}

	for (const [key, value] of Object.entries(params)) {
		if (key === "args") {
			continue;
		}

		config[key] = value;
	}

	return { callback, config };
}

function normalizeYtdlpQualitySelector(value: string): string {
	const normalized = value.trim().toLowerCase();
	if (normalized.length === 0 || normalized === "best") {
		return "bestvideo*+bestaudio/best";
	}

	const heightMatch = normalized.match(/(\d{3,4})/u);
	if (heightMatch?.[1]) {
		return `bestvideo*[height<=${heightMatch[1]}]+bestaudio/best[height<=${heightMatch[1]}]`;
	}

	return value.trim();
}

function buildYtdlpDslFormatSelector(config: Record<string, unknown>): string | undefined {
	const selector = parseOptionalString(config.selector ?? config.formatSelector, "format.selector");
	if (selector) {
		return selector;
	}

	const quality = parseOptionalString(config.quality, "format.quality");
	const ext = parseOptionalString(config.ext, "format.ext");
	if (!quality && !ext) {
		return undefined;
	}

	const baseSelector = quality ? normalizeYtdlpQualitySelector(quality) : "bestvideo*+bestaudio/best";
	if (!ext) {
		return baseSelector;
	}

	const [primaryVideoSelector, fallbackSelector = "best"] = baseSelector.split("/", 2);
	const extFilter = `[ext=${ext}]`;
	const fallbackFilter = quality && /\d{3,4}/u.test(quality)
		? fallbackSelector.replace(/best\*?/u, `best${extFilter}`)
		: `best${extFilter}`;
	return `${primaryVideoSelector.replace(/bestvideo\*?/u, `bestvideo*${extFilter}`)}+bestaudio/${fallbackFilter}`;
}

function normalizeYtdlpOutputTemplateValue(value: string): string {
	return value.replace(/^~\//u, "/root/");
}

function buildYtdlpDslBindingParams(config: Record<string, unknown>, action: "download" | "info" | "listFormats") {
	const url = parseOptionalString(config.url, `${action}.url`);
	if (!url) {
		throw new InvalidParamsError(`url is required for pkg/ydlp.${action}.`);
	}

	const result: Record<string, unknown> = { url };
	const cookiesPath = parseOptionalString(config.cookiesPath, "cookiesPath");
	const proxyServer = parseOptionalString(config.server ?? config.proxy, "proxy.server");
	const playlistItems = parseOptionalString(config.playlistItems, "playlistItems");
	const noPlaylist = parseOptionalBoolean(config.noPlaylist, "noPlaylist");
	const extraArgs = parseOptionalStringArray(config.extraArgs, "extraArgs");

	if (cookiesPath) {
		result.cookiesPath = cookiesPath;
	}
	if (proxyServer) {
		result.proxy = proxyServer;
	}
	if (playlistItems) {
		result.playlistItems = playlistItems;
	}
	if (noPlaylist !== undefined) {
		result.noPlaylist = noPlaylist;
	}
	if (extraArgs && extraArgs.length > 0) {
		result.extraArgs = [...extraArgs];
	}

	if (action === "download") {
		const formatSelector = parseBooleanFlag(config, "format") ? buildYtdlpDslFormatSelector(config) : undefined;
		const template = parseOptionalString(config.template ?? config.outputTemplate, "output.template");
		const outputDir = parseOptionalString(config.dir ?? config.outputDir, "output.dir");
		const extractAudio = parseBooleanFlag(config, "onlyAudio") || parseOptionalBoolean(config.extractAudio, "extractAudio") === true;
		const codec = parseOptionalString(config.codec ?? config.audioFormat, "onlyAudio.codec");
		const bitrate = parseOptionalString(config.bitrate ?? config.audioQuality, "onlyAudio.bitrate");
		const embedThumbnails = parseOptionalBoolean(config.thumbnails ?? config.embedThumbnail, "embed.thumbnails");
		const embedMetadata = parseOptionalBoolean(config.metadata ?? config.embedMetadata, "embed.metadata");
		const embedChapters = parseOptionalBoolean(config.chapters ?? config.embedChapters, "embed.chapters");
		const subtitlesValue = config.subtitles ?? config.subLangs;
		const subtitleLanguages = Array.isArray(subtitlesValue)
			? parseOptionalStringArray(subtitlesValue, "embed.subtitles")
			: typeof subtitlesValue === "string"
				? parseOptionalStringArray([subtitlesValue], "embed.subtitles")
				: parseOptionalBoolean(subtitlesValue, "embed.subtitles") === true
					? ["all"]
					: undefined;
		const rate = parseOptionalString(config.rate ?? config.limitRate, "limit.rate");
		const sleep = parseOptionalNumber(config.sleep ?? config.sleepInterval, "limit.sleep");

		if (formatSelector) {
			result.format = formatSelector;
		}
		if (template) {
			result.outputTemplate = normalizeYtdlpOutputTemplateValue(template);
		}
		if (outputDir) {
			result.outputDir = normalizeYtdlpOutputTemplateValue(outputDir);
		}
		if (extractAudio) {
			result.extractAudio = true;
			result.format = result.format ?? "bestaudio/best";
		}
		if (codec) {
			result.audioFormat = codec;
		}
		if (bitrate) {
			result.audioQuality = bitrate;
		}
		if (embedThumbnails === true) {
			result.embedThumbnail = true;
		}
		if (embedMetadata === true) {
			result.embedMetadata = true;
		}
		if (embedChapters === true) {
			result.embedChapters = true;
		}
		if (subtitleLanguages && subtitleLanguages.length > 0) {
			result.writeSub = true;
			result.embedSubs = true;
			result.subLangs = subtitleLanguages;
		}
		if (rate) {
			result.limitRate = rate;
		}
		if (sleep !== undefined) {
			result.sleepInterval = sleep;
		}

		const directPassThrough: Array<[string, unknown, (value: unknown, label: string) => unknown]> = [
			["mergeOutputFormat", config.mergeOutputFormat, parseOptionalString],
			["remuxVideo", config.remuxVideo, parseOptionalString],
			["recodeVideo", config.recodeVideo, parseOptionalString],
			["playlistItems", config.playlistItems, parseOptionalString],
			["writeDescription", config.writeDescription, parseOptionalBoolean],
			["writeComments", config.writeComments, parseOptionalBoolean],
			["writeInfoJson", config.writeInfoJson, parseOptionalBoolean],
			["writeThumbnail", config.writeThumbnail, parseOptionalBoolean],
			["embedSubs", config.embedSubs, parseOptionalBoolean],
			["splitChapters", config.splitChapters, parseOptionalBoolean],
			["keepVideo", config.keepVideo, parseOptionalBoolean],
			["noPart", config.noPart, parseOptionalBoolean],
			["restrictFilenames", config.restrictFilenames, parseOptionalBoolean],
			["forceOverwrites", config.forceOverwrites, parseOptionalBoolean],
			["noMtime", config.noMtime, parseOptionalBoolean],
			["retries", config.retries, parseOptionalNumber],
			["fragmentRetries", config.fragmentRetries, parseOptionalNumber],
			["concurrentFragments", config.concurrentFragments, parseOptionalNumber],
			["sponsorBlockMark", config.sponsorBlockMark, parseOptionalStringArray],
			["sponsorBlockRemove", config.sponsorBlockRemove, parseOptionalStringArray],
		];

		for (const [key, value, parser] of directPassThrough) {
			const parsedValue = parser(value, key);
			if (parsedValue !== undefined) {
				result[key] = parsedValue;
			}
		}
	} else if (action === "info") {
		const flatPlaylist = parseOptionalBoolean(config.flatPlaylist, "flatPlaylist");
		if (flatPlaylist !== undefined) {
			result.flatPlaylist = flatPlaylist;
		}
	}

	return result;
}

async function executeYtdlpDslModule(
	context: ModuleExecutionContext<YtdlpDslParams, object>,
): Promise<unknown> {
	const kit = await ensureBpkgKit(context, "module:pkg/ytdlp");
	const { callback, config } = normalizeYtdlpDslParams(context.params);
	const actions = readYtdlpTerminalActions(config);
	const finalActions = actions.filter((action) => action === "download" || action === "getInfo" || action === "listFormats");
	const importActions = actions.filter((action) => action === "importCookies" || action === "importCookiesFromCloakBrowser");

	if (finalActions.length > 1) {
		throw new InvalidParamsError("Use only one terminal ydlp action per chain: download, getInfo, or listFormats.");
	}
	if (importActions.length > 1) {
		throw new InvalidParamsError("Use only one cookie import action per chain: importCookies or importCookiesFromCloakBrowser.");
	}

	let lastResult: unknown = null;
	if (importActions[0] === "importCookies") {
		const pathValue = parseOptionalString(config.path ?? config.cookies, "importCookies.path");
		if (!pathValue) {
			throw new InvalidParamsError("path is required for $.pkg.ydlp.importCookies.with({ path }).");
		}
		lastResult = await kit.executePackageBinding(YTDLP_PACKAGE_ID, "importCookies", { path: pathValue }, {
			runtime: createBpkgBindingRuntimeBridge(context),
		});
	}
	if (importActions[0] === "importCookiesFromCloakBrowser") {
		const profileId = parseOptionalString(config.profileId, "importCookiesFromCloakBrowser.profileId");
		const domains = parseOptionalStringArray(config.domains, "importCookiesFromCloakBrowser.domains");
		if (!profileId) {
			throw new InvalidParamsError("profileId is required for $.pkg.ydlp.importCookiesFromCloakBrowser.with({ profileId }).");
		}
		lastResult = await kit.executePackageBinding(YTDLP_PACKAGE_ID, "importCookiesFromCloakBrowser", {
			...(domains ? { domains } : {}),
			profileId,
		}, {
			runtime: createBpkgBindingRuntimeBridge(context),
		});
	}

	const finalAction = finalActions[0];
	if (!finalAction) {
		if (lastResult !== null) {
			return lastResult;
		}

		throw new InvalidParamsError("Incomplete $.pkg.ydlp chain. Finish with .download, .getInfo, .listFormats, or an import action.");
	}

	const bindingId = finalAction === "getInfo"
		? "info"
		: finalAction === "listFormats"
			? "listFormats"
			: "download";
	const bindingParams = buildYtdlpDslBindingParams(config, finalAction as "download" | "info" | "listFormats");
	const progressReporter = callback && bindingId === "download"
		? createYtdlpProgressReporter(callback)
		: null;
	if (progressReporter) {
		const existingExtraArgs = Array.isArray(bindingParams.extraArgs)
			? bindingParams.extraArgs.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
			: [];
		bindingParams.extraArgs = [
			...existingExtraArgs,
			...(existingExtraArgs.includes("--newline") ? [] : ["--newline"]),
			...(existingExtraArgs.includes("--progress") ? [] : ["--progress"]),
		];
	}
	return await kit.executePackageBinding(YTDLP_PACKAGE_ID, bindingId, bindingParams, {
		...(progressReporter
			? {
				commandHandlers: {
					onStderrChunk: progressReporter,
					onStdoutChunk: progressReporter,
				},
			}
			: {}),
		runtime: createBpkgBindingRuntimeBridge(context),
	});
}

function createYtdlpProgressReporter(
	callback: (progress: unknown) => void,
): (chunk: string) => void {
	let pending = "";
	const flush = (line: string) => {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}

		const progressMatch = trimmed.match(/^\[download\]\s+([0-9.]+)% of\s+(.+?)(?: at\s+(.+?))?(?: ETA\s+(.+))?$/u);
		if (progressMatch) {
			callback({
				eta: progressMatch[4]?.trim() || undefined,
				percent: Number(progressMatch[1]),
				raw: trimmed,
				size: progressMatch[2]?.trim() || undefined,
				speed: progressMatch[3]?.trim() || undefined,
				stage: "download",
			});
			return;
		}

		if (trimmed.startsWith("[download]")) {
			callback({ raw: trimmed, stage: "download" });
			return;
		}

		if (/^\[ExtractAudio\]/u.test(trimmed)) {
			callback({ raw: trimmed, stage: "postprocess" });
			return;
		}

		if (/^\[MetadataParser\]|^\[EmbedThumbnail\]|^\[Merger\]|^\[Fixup/u.test(trimmed)) {
			callback({ raw: trimmed, stage: "postprocess" });
		}
	};

	return (chunk: string) => {
		pending += chunk;
		const segments = pending.split(/\r?\n|\r/gu);
		pending = segments.pop() ?? "";
		for (const segment of segments) {
			flush(segment);
		}

		if (pending.startsWith("[download] ") && pending.includes("%")) {
			flush(pending);
			pending = "";
		}
	};
}

function readAtoolTerminalActions(record: Record<string, unknown>): string[] {
	return ["pack", "unpack", "list", "cat", "diff", "repack"]
		.filter((fieldName) => parseBooleanFlag(record, fieldName));
}

function normalizeAtoolDslParams(params: unknown): Record<string, unknown> {
	if (!isRecord(params)) {
		throw new InvalidParamsError("pkg/atool expects object-style params or the JS chain form $.pkg.atool....");
	}

	const config: Record<string, unknown> = {};
	const args = Array.isArray(params.args) ? params.args : [];
	for (const arg of args) {
		if (!isRecord(arg)) {
			throw new InvalidParamsError("pkg/atool expects object blocks in the JS chain form.");
		}

		Object.assign(config, arg);
	}

	for (const [key, value] of Object.entries(params)) {
		if (key === "args") {
			continue;
		}

		config[key] = value;
	}

	return config;
}

function normalizeAtoolListOutputMode(value: unknown): "raw" | "lines" | "table" | undefined {
	const normalized = parseOptionalString(value, "list.format");
	if (!normalized) {
		return undefined;
	}

	const lowerCaseValue = normalized.toLowerCase();
	if (lowerCaseValue !== "raw" && lowerCaseValue !== "lines" && lowerCaseValue !== "table") {
		throw new InvalidParamsError("list.format must be one of raw, lines, or table.");
	}

	return lowerCaseValue as "raw" | "lines" | "table";
}

function buildAtoolCommonDslParams(config: Record<string, unknown>): Record<string, unknown> {
	const explain = parseOptionalBoolean(config.explain, "options.explain");
	const simulate = parseOptionalBoolean(config.simulate, "options.simulate");
	const quiet = parseOptionalBoolean(config.quiet, "options.quiet");
	const verbose = parseOptionalBoolean(config.verbose, "options.verbose");
	const verbosity = parseOptionalNumber(config.verbosity, "options.verbosity");
	const optionsPath = parseOptionalString(config.config, "options.config");
	const rawOptions = config.option ?? (typeof config.options === "boolean" ? undefined : config.options);
	const options = parseOptionalStringArray(rawOptions, "options.option");
	const formatOptions = parseOptionalStringArray(config.formatOptions ?? config.formatOption, "options.formatOptions");

	return {
		...(explain !== undefined ? { explain } : {}),
		...(simulate !== undefined ? { simulate } : {}),
		...(quiet !== undefined ? { quiet } : {}),
		...(verbose !== undefined ? { verbose } : {}),
		...(verbosity !== undefined ? { verbosity } : {}),
		...(optionsPath ? { config: optionsPath } : {}),
		...(options && options.length > 0 ? { options: [...options] } : {}),
		...(formatOptions && formatOptions.length > 0 ? { formatOptions: [...formatOptions] } : {}),
	};
}

function buildAtoolPackDslParams(config: Record<string, unknown>): Record<string, unknown> {
	const recursive = parseOptionalBoolean(config.recursive, "input.recursive");
	if (recursive === false) {
		throw new InvalidParamsError("input.recursive=false is not supported in v1. Directories are packed recursively by the underlying archiver.");
	}
	if (parseOptionalBoolean(config.each, "pack.each") === true) {
		throw new InvalidParamsError("pack.each is not supported in v1. Use one target archive per call.");
	}

	const paths = parseOptionalStringArray(config.paths ?? config.path, "input.path");
	if (!paths || paths.length === 0) {
		throw new InvalidParamsError("input.path is required for $.pkg.atool.input.with({ path }).pack.with(...).");
	}

	const target = parseOptionalString(config.target, "pack.target");
	if (!target) {
		throw new InvalidParamsError("target is required for $.pkg.atool.pack.with({ target }).");
	}

	const format = parseOptionalString(config.format, "pack.format");
	const overwrite = parseOptionalBoolean(config.overwrite, "pack.overwrite");
	const level = parseOptionalNumber(config.level, "pack.level");
	const password = parseOptionalString(config.password, "pack.password");
	const nullSeparated = parseOptionalBoolean(config.nullSeparated, "pack.nullSeparated");

	return {
		...buildAtoolCommonDslParams(config),
		...(format ? { format } : {}),
		...(overwrite !== undefined ? { overwrite } : {}),
		...(level !== undefined ? { level } : {}),
		...(password ? { password } : {}),
		...(nullSeparated !== undefined ? { nullSeparated } : {}),
		paths: [...paths],
		target,
	};
}

function buildAtoolUnpackDslParams(config: Record<string, unknown>): Record<string, unknown> {
	const archive = parseOptionalString(config.archive, "unpack.archive");
	if (!archive) {
		throw new InvalidParamsError("archive is required for $.pkg.atool.unpack.with({ archive }).");
	}

	const to = parseOptionalString(config.to, "unpack.to");
	const each = parseOptionalBoolean(config.each, "unpack.each");
	const overwrite = parseOptionalBoolean(config.overwrite, "unpack.overwrite");
	const subdir = parseOptionalBoolean(config.subdir, "unpack.subdir");
	const files = parseOptionalStringArray(config.files, "unpack.files");
	const archiveFormat = parseOptionalString(config.archiveFormat, "unpack.archiveFormat");

	return {
		...buildAtoolCommonDslParams(config),
		...(archiveFormat ? { archiveFormat } : {}),
		...(to ? { to } : {}),
		...(each !== undefined ? { each } : {}),
		...(overwrite !== undefined ? { overwrite } : {}),
		...(subdir !== undefined ? { subdir } : {}),
		...(files && files.length > 0 ? { files: [...files] } : {}),
		archive,
	};
}

function buildAtoolListDslParams(config: Record<string, unknown>): Record<string, unknown> {
	const archive = parseOptionalString(config.archive, "list.archive");
	if (!archive) {
		throw new InvalidParamsError("archive is required for $.pkg.atool.list.with({ archive }).");
	}

	const outputMode = normalizeAtoolListOutputMode(config.format ?? config.outputMode);
	const files = parseOptionalStringArray(config.files, "list.files");
	const archiveFormat = parseOptionalString(config.archiveFormat, "list.archiveFormat");

	return {
		...buildAtoolCommonDslParams(config),
		...(archiveFormat ? { archiveFormat } : {}),
		...(files && files.length > 0 ? { files: [...files] } : {}),
		...(outputMode ? { outputMode } : {}),
		archive,
	};
}

function buildAtoolCatDslParams(config: Record<string, unknown>): Record<string, unknown> {
	const archive = parseOptionalString(config.archive, "cat.archive");
	if (!archive) {
		throw new InvalidParamsError("archive is required for $.pkg.atool.cat.with({ archive, file }).");
	}

	const file = parseOptionalString(config.file, "cat.file");
	if (!file) {
		throw new InvalidParamsError("file is required for $.pkg.atool.cat.with({ archive, file }).");
	}

	const archiveFormat = parseOptionalString(config.archiveFormat, "cat.archiveFormat");
	return {
		...buildAtoolCommonDslParams(config),
		...(archiveFormat ? { archiveFormat } : {}),
		archive,
		file,
	};
}

function buildAtoolDiffDslParams(config: Record<string, unknown>): Record<string, unknown> {
	const first = parseOptionalString(config.first, "diff.first");
	const second = parseOptionalString(config.second, "diff.second");
	if (!first || !second) {
		throw new InvalidParamsError("first and second are required for $.pkg.atool.diff.with({ first, second }).");
	}

	const diffArgs = parseOptionalStringArray(config.diffArgs, "diff.diffArgs");
	return {
		...buildAtoolCommonDslParams(config),
		...(diffArgs && diffArgs.length > 0 ? { diffArgs: [...diffArgs] } : {}),
		first,
		second,
	};
}

function buildAtoolRepackDslParams(config: Record<string, unknown>): Record<string, unknown> {
	const source = parseOptionalString(config.source, "repack.source");
	const target = parseOptionalString(config.target, "repack.target");
	if (!source || !target) {
		throw new InvalidParamsError("source and target are required for $.pkg.atool.repack.with({ source, target }).");
	}

	const format = parseOptionalString(config.format, "repack.format");
	const level = parseOptionalNumber(config.level, "repack.level");
	const password = parseOptionalString(config.password, "repack.password");

	return {
		...buildAtoolCommonDslParams(config),
		...(format ? { format } : {}),
		...(level !== undefined ? { level } : {}),
		...(password ? { password } : {}),
		source,
		target,
	};
}

async function executeAtoolDslModule(
	context: ModuleExecutionContext<AtoolDslParams, object>,
): Promise<unknown> {
	const kit = await ensureBpkgKit(context, "module:pkg/atool");
	const config = normalizeAtoolDslParams(context.params);
	const actions = readAtoolTerminalActions(config);
	if (actions.length === 0) {
		throw new InvalidParamsError("Incomplete $.pkg.atool chain. Finish with .pack, .unpack, .list, .cat, .diff, or .repack.");
	}
	if (actions.length > 1) {
		throw new InvalidParamsError("Use only one terminal atool action per chain: pack, unpack, list, cat, diff, or repack.");
	}

	const action = actions[0] ?? "pack";
	const bindingParams = (() => {
		switch (action) {
			case "pack":
				return buildAtoolPackDslParams(config);
			case "unpack":
				return buildAtoolUnpackDslParams(config);
			case "list":
				return buildAtoolListDslParams(config);
			case "cat":
				return buildAtoolCatDslParams(config);
			case "diff":
				return buildAtoolDiffDslParams(config);
			case "repack":
				return buildAtoolRepackDslParams(config);
			default:
				throw new InvalidParamsError(`Unsupported pkg/atool action '${action}'.`);
		}
	})();

	return await kit.executePackageBinding(ATOOL_PACKAGE_ID, action, bindingParams, {
		runtime: createBpkgBindingRuntimeBridge(context),
	});
}

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

function createBpkgBindingRuntimeBridge(
	context: ModuleExecutionContext<Record<string, unknown>, object>,
): BpkgBindingRuntimeBridge {
	return {
		getKit: (id) => context.getKit(id),
		ensureKit: async (id, createKit, attachContext = {}) => {
			const existingKit = context.getKit(id);
			if (existingKit) {
				return existingKit;
			}

			const nextKit = await createKit();
			return await context.runtime.attachKit(nextKit as Kit, attachContext) as typeof nextKit;
		},
	};
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

function parseOptionalBpkgPrivilegeLevel(value: unknown, fieldName: string): BpkgPrivilegeLevel | undefined {
	const normalized = parseOptionalString(value, fieldName);
	if (!normalized) {
		return undefined;
	}

	if (!BPKG_PRIVILEGE_LEVELS.includes(normalized as BpkgPrivilegeLevel)) {
		throw new InvalidParamsError(`${fieldName} must be one of: ${BPKG_PRIVILEGE_LEVELS.join(", ")}.`);
	}

	return normalized as BpkgPrivilegeLevel;
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

function parseOptionalBpkgPrivilegeLevelArray(
	value: unknown,
	fieldName: string,
): readonly BpkgPrivilegeLevel[] | undefined {
	const entries = parseOptionalStringArray(value, fieldName);
	if (!entries) {
		return undefined;
	}

	return entries.map((entry, index) => parseOptionalBpkgPrivilegeLevel(entry, `${fieldName}[${index}]`) as BpkgPrivilegeLevel);
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

function parseOptionalJsonObject(value: unknown, fieldName: string): Record<string, unknown> | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value === "string") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(value);
		} catch {
			throw new InvalidParamsError(`${fieldName} must be a valid JSON object.`);
		}

		if (!isRecord(parsed)) {
			throw new InvalidParamsError(`${fieldName} must be a JSON object.`);
		}

		return parsed;
	}

	if (!isRecord(value)) {
		throw new InvalidParamsError(`${fieldName} must be an object.`);
	}

	return value;
}

function parseOptionalSandboxPolicyExtensions(
	value: unknown,
	fieldName: string,
): BpkgSandboxPolicyExtensionsInput | undefined {
	const parsed = parseOptionalJsonObject(value, fieldName);
	if (!parsed) {
		return undefined;
	}

	try {
		return parseBpkgSandboxPolicyExtensionsInput(parsed, fieldName);
	} catch (error) {
		throw new InvalidParamsError(error instanceof Error ? error.message : String(error));
	}
}

function normalizeCreateParams(params: BpkgCreateParams): NormalizedBpkgCreateParams {
	const id = parseRequiredString(params.id, "id");
	return {
		allowedPrivilegeLevels: parseOptionalBpkgPrivilegeLevelArray(params.allowedPrivilegeLevels, "allowedPrivilegeLevels"),
		description: parseOptionalString(params.description, "description"),
		defaultPrivilegeLevel: parseOptionalBpkgPrivilegeLevel(params.defaultPrivilegeLevel ?? params.privilegeLevel, "defaultPrivilegeLevel"),
		id,
		name: parseOptionalString(params.name, "name"),
		packages: parseOptionalStringArray(params.packages, "packages"),
		sandboxPolicyExtensions: parseOptionalSandboxPolicyExtensions(params.sandboxPolicyExtensions, "sandboxPolicyExtensions"),
	};
}

function normalizeTargetBoxId(params: BpkgGetParams | BpkgSelectParams | BpkgInstallParams | BpkgPrivilegeSetParams): string | undefined {
	const fallbackId = "id" in params ? params.id : undefined;
	const fallbackTarget = "target" in params ? params.target : undefined;
	return parseOptionalString(params.boxId ?? fallbackId ?? fallbackTarget, "boxId");
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
				privilegeLevel: parseOptionalBpkgPrivilegeLevel(executionValue.privilegeLevel, "privilegeLevel"),
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
		privilegeLevel: parseOptionalBpkgPrivilegeLevel(params.privilegeLevel, "privilegeLevel"),
	};
}

function normalizePrivilegeSetParams(params: BpkgPrivilegeSetParams): NormalizedBpkgPrivilegeSetParams {
	return {
		allowedPrivilegeLevels: parseOptionalBpkgPrivilegeLevelArray(params.allowedPrivilegeLevels, "allowedPrivilegeLevels"),
		boxId: normalizeTargetBoxId(params),
		defaultPrivilegeLevel: parseOptionalBpkgPrivilegeLevel(params.defaultPrivilegeLevel ?? params.privilegeLevel, "defaultPrivilegeLevel"),
		sandboxPolicyExtensions: parseOptionalSandboxPolicyExtensions(params.sandboxPolicyExtensions, "sandboxPolicyExtensions"),
	};
}

function resolvePrivilegeTargetBoxId(kit: BpkgKit, params: BpkgPrivilegeSetParams): string {
	const explicitBoxId = normalizeTargetBoxId(params);
	if (explicitBoxId) {
		return explicitBoxId;
	}

	const defaultBoxId = kit.getDefaultBoxId();
	if (!defaultBoxId) {
		throw new InvalidParamsError("boxId is required when no default bpkg box is selected.");
	}

	return defaultBoxId;
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
		{ name: "defaultPrivilegeLevel", detail: "Default privilege level used for commands in this box", example: "sandbox-ro", valueType: "string" },
		{ name: "allowedPrivilegeLevels", detail: "Privilege levels allowed for overrides in this box", example: "sandbox-ro,sandbox-rw", valueType: "string[]" },
		{ name: "sandboxPolicyExtensions", detail: "Optional sandbox mount/share policy extensions as JSON", example: '{"sysMode":"host-ro","devMode":"host"}', valueType: "json" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureBpkgKit(context, "module:bpkg/create");
		return await kit.createBox(normalizeCreateParams(context.params));
	}),
}).useDefault("id");

export const bpkgPrivilegeGetModule = defineModule<BpkgPrivilegeGetParams, BpkgBoxPrivilegeConfig | null>({
	id: "bpkg/privilege/get",
	category: "bpkg",
	description: "Inspect the privilege policy for a bpkg box or the selected default box.",
	consoleParams: [
		{ name: "boxId", detail: "Optional bpkg box id", example: "metasploit", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureBpkgKit(context, "module:bpkg/privilege/get");
		const boxId = normalizeTargetBoxId(context.params);
		const box = boxId ? kit.getBox(boxId) : kit.getDefaultBox();
		return box ? kit.getBoxPrivilege(box.id) : null;
	}),
}).useDefault("boxId");

export const bpkgPrivilegeSetModule = defineModule<BpkgPrivilegeSetParams, BpkgBoxRecord>({
	id: "bpkg/privilege/set",
	category: "bpkg",
	description: "Set the default, allowed, and sandbox extension policy for a bpkg box.",
	consoleParams: [
		{ name: "boxId", detail: "Target box id; defaults to the selected box", example: "metasploit", valueType: "string" },
		{ name: "defaultPrivilegeLevel", detail: "Default privilege level for this box", example: "sandbox-ro", valueType: "string" },
		{ name: "allowedPrivilegeLevels", detail: "Allowed privilege levels for this box", example: "sandbox-ro,sandbox-rw", valueType: "string[]" },
		{ name: "sandboxPolicyExtensions", detail: "Optional sandbox mount/share policy extensions as JSON", example: '{"sysMode":"sysfs","extraBindMounts":[{"source":"/run/dbus","target":"/run/dbus","mode":"ro-bind"}]}', valueType: "json" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureBpkgKit(context, "module:bpkg/privilege/set");
		const normalized = normalizePrivilegeSetParams(context.params);
		if (
			!normalized.defaultPrivilegeLevel
			&& (!normalized.allowedPrivilegeLevels || normalized.allowedPrivilegeLevels.length === 0)
			&& !normalized.sandboxPolicyExtensions
		) {
			throw new InvalidParamsError("bpkg/privilege/set requires defaultPrivilegeLevel, allowedPrivilegeLevels, or sandboxPolicyExtensions.");
		}

		return await kit.setBoxPrivilege(resolvePrivilegeTargetBoxId(kit, normalized), {
			allowedPrivilegeLevels: normalized.allowedPrivilegeLevels,
			defaultPrivilegeLevel: normalized.defaultPrivilegeLevel,
			sandboxPolicyExtensions: normalized.sandboxPolicyExtensions,
		});
	}),
});

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
		{ name: "privilegeLevel", detail: "Optional one-shot privilege override for this command", example: "sandbox-rw", valueType: "string" },
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

export const ytdlpDslModule = defineModule<YtdlpDslParams, unknown>({
	id: `pkg/${YTDLP_PACKAGE_ID}`,
	aliases: [`pkg/${YTDLP_PACKAGE_ALIAS}`],
	category: "pkg",
	description: "Chainable yt-dlp DSL root for $.pkg.ydlp.format/output/embed/limit/proxy/... helpers.",
	consoleParams: [
		{ name: "download", detail: "Execute a yt-dlp download action from the accumulated chain config.", valueType: "boolean", jsDescriptorName: "download" },
		{ name: "getInfo", detail: "Fetch structured yt-dlp metadata from the accumulated chain config.", valueType: "boolean", jsDescriptorName: "getInfo" },
		{ name: "listFormats", detail: "Fetch structured yt-dlp formats from the accumulated chain config.", valueType: "boolean", jsDescriptorName: "listFormats" },
		{ name: "importCookies", detail: "Import a persistent cookie jar before the final action.", valueType: "boolean", jsDescriptorName: "importCookies" },
		{ name: "importCookiesFromCloakBrowser", detail: "Import cookies from a CloakBrowser profile before the final action.", valueType: "boolean", jsDescriptorName: "importCookiesFromCloakBrowser" },
		{ name: "format", detail: "Activate the format selection config block for quality/ext selectors.", valueType: "boolean", jsDescriptorName: "format" },
		{ name: "onlyAudio", detail: "Activate audio-only config mapping for codec and bitrate.", valueType: "boolean", jsDescriptorName: "onlyAudio" },
		{ name: "output", detail: "Activate output template or directory config mapping.", valueType: "boolean", jsDescriptorName: "output" },
		{ name: "embed", detail: "Activate embed config mapping for metadata, thumbnails, subtitles, and chapters.", valueType: "boolean", jsDescriptorName: "embed" },
		{ name: "limit", detail: "Activate transfer limit config mapping for rate and sleep interval.", valueType: "boolean", jsDescriptorName: "limit" },
		{ name: "proxy", detail: "Activate proxy config mapping for server-based routing.", valueType: "boolean", jsDescriptorName: "proxy" },
		{ name: "onUpdate", detail: "Reserved progress callback hook for future streaming execution support.", valueType: "boolean", jsDescriptorName: "onUpdate" },
		{ name: "url", detail: "Target media or playlist URL for download/getInfo/listFormats.", example: "https://www.youtube.com/watch?v=BaW_jenozKc", valueType: "string" },
		{ name: "quality", detail: "Quality helper for .format.with({ quality }). Example: 1080p.", example: "1080p", valueType: "string" },
		{ name: "ext", detail: "Container filter helper for .format.with({ ext }).", example: "mp4", valueType: "string" },
		{ name: "codec", detail: "Audio codec helper for .onlyAudio.with({ codec }).", example: "mp3", valueType: "string" },
		{ name: "bitrate", detail: "Audio bitrate or quality helper for .onlyAudio.with({ bitrate }).", example: "320K", valueType: "string" },
		{ name: "template", detail: "Output template helper for .output.with({ template }).", example: "%(title)s.%(ext)s", valueType: "string" },
		{ name: "dir", detail: "Output directory helper for .output.with({ dir }).", example: "/root/Downloads", valueType: "string" },
		{ name: "thumbnails", detail: "Embed block helper for thumbnail embedding.", example: "true", valueType: "boolean" },
		{ name: "subtitles", detail: "Embed block helper for subtitle language selection.", example: "en", valueType: "string" },
		{ name: "metadata", detail: "Embed block helper for metadata embedding.", example: "true", valueType: "boolean" },
		{ name: "chapters", detail: "Embed block helper for chapter embedding.", example: "true", valueType: "boolean" },
		{ name: "rate", detail: "Limit block helper for rate limiting, for example 10M.", example: "10M", valueType: "string" },
		{ name: "sleep", detail: "Limit block helper for pause interval between downloads in seconds.", example: "5", valueType: "number" },
		{ name: "server", detail: "Proxy block helper for socks/http proxy URLs.", example: "socks5://user:pass@host:1080", valueType: "string" },
		{ name: "path", detail: "Cookie import helper for host Netscape cookie jar path.", example: "/home/john/cookies.txt", valueType: "string" },
		{ name: "cookies", detail: "Alias of path for root DSL cookie import chains.", example: "/home/john/cookies.txt", valueType: "string" },
		{ name: "profileId", detail: "Cloak profile id for .importCookiesFromCloakBrowser.", example: "profile-123", valueType: "string" },
	],
	executor: defineExecutor(async (context) => await executeYtdlpDslModule(context)),
});

export const atoolDslModule = defineModule<AtoolDslParams, unknown>({
	id: `pkg/${ATOOL_PACKAGE_ID}`,
	category: "pkg",
	description: "Chainable atool DSL root for $.pkg.atool.input/options/pack/unpack/list/cat/diff/repack helpers.",
	consoleParams: [
		{ name: "input", detail: "Activate the pack input config block for path lists.", valueType: "boolean", jsDescriptorName: "input" },
		{ name: "options", detail: "Activate the shared atool options config block.", valueType: "boolean", jsDescriptorName: "options" },
		{ name: "pack", detail: "Create an archive with apack from the accumulated chain config.", valueType: "boolean", jsDescriptorName: "pack" },
		{ name: "unpack", detail: "Extract an archive with aunpack from the accumulated chain config.", valueType: "boolean", jsDescriptorName: "unpack" },
		{ name: "list", detail: "List archive contents with als from the accumulated chain config.", valueType: "boolean", jsDescriptorName: "list" },
		{ name: "cat", detail: "Read a file from an archive with acat from the accumulated chain config.", valueType: "boolean", jsDescriptorName: "cat" },
		{ name: "diff", detail: "Diff two archives with adiff from the accumulated chain config.", valueType: "boolean", jsDescriptorName: "diff" },
		{ name: "repack", detail: "Repack an archive with arepack from the accumulated chain config.", valueType: "boolean", jsDescriptorName: "repack" },
		{ name: "path", detail: "Input path or path list for the .input config block.", example: "/root/logs,/root/configs/nginx.conf", valueType: "string[]" },
		{ name: "recursive", detail: "Pack directories recursively; only true or omitted are supported in v1.", example: "true", valueType: "boolean" },
		{ name: "target", detail: "Target archive path for .pack or .repack.", example: "/root/backup.7z", valueType: "string" },
		{ name: "archive", detail: "Archive path for .unpack, .list, or .cat.", example: "/root/data.zip", valueType: "string" },
		{ name: "to", detail: "Extraction target path for .unpack.", example: "/root/extracted_data", valueType: "string" },
		{ name: "file", detail: "File path inside an archive for .cat.", example: "readme.txt", valueType: "string" },
		{ name: "first", detail: "First archive path for .diff.", example: "/root/old_version.tar.gz", valueType: "string" },
		{ name: "second", detail: "Second archive path for .diff.", example: "/root/new_version.tar.gz", valueType: "string" },
		{ name: "format", detail: "Archive format override for .pack or .repack, or output mode for .list.", example: "7z", valueType: "string" },
		{ name: "archiveFormat", detail: "Explicit archive format override for extract/list/cat chains.", example: "zip", valueType: "string" },
		{ name: "level", detail: "7z-only compression level helper for .pack or .repack.", example: "9", valueType: "number" },
		{ name: "password", detail: "7z-only password helper for .pack or .repack.", example: "john_secret_pass", valueType: "string" },
		{ name: "overwrite", detail: "Overwrite existing files or archives when supported by the terminal action.", example: "true", valueType: "boolean" },
		{ name: "each", detail: "Pass --each for .unpack chains when needed.", example: "true", valueType: "boolean" },
		{ name: "subdir", detail: "Force subdirectory extraction for .unpack.", example: "true", valueType: "boolean" },
		{ name: "explain", detail: "Display the command executed under the hood.", example: "true", valueType: "boolean" },
		{ name: "simulate", detail: "Run atool in simulate mode without real writes.", example: "true", valueType: "boolean" },
		{ name: "quiet", detail: "Decrease verbosity by one.", example: "true", valueType: "boolean" },
		{ name: "verbose", detail: "Increase verbosity by one.", example: "true", valueType: "boolean" },
		{ name: "verbosity", detail: "Explicit atool verbosity level.", example: "1", valueType: "number" },
	],
	executor: defineExecutor(async (context) => await executeAtoolDslModule(context)),
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
		notebookTypeOverlay: bindingDefinition.notebookTypeOverlay,
		consoleParams: createBpkgBindingConsoleParams(packageDefinition, bindingId),
		executor: defineExecutor(async (context) => {
			const kit = await ensureBpkgKit(context, `module:pkg/${packageId}/${bindingId}`);
			return await kit.executePackageBinding(packageId, bindingId, context.params, {
				runtime: createBpkgBindingRuntimeBridge(context),
			});
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