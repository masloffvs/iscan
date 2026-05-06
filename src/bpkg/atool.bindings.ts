import {
	defineBindings,
	type BpkgBindingResponseParser,
	type BpkgTranspiledCommand,
} from "./define-bindings";

const ATOOL_LIST_OUTPUT_MODES = new Set(["raw", "lines", "table"]);

function normalizeRequiredString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} must be a string.`);
	}

	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new Error(`${label} must be a non-empty string.`);
	}

	return normalized;
}

function normalizeOptionalString(value: unknown, label: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	return normalizeRequiredString(value, label);
}

function normalizeBoolean(value: unknown, label: string): boolean | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value !== "boolean") {
		throw new Error(`${label} must be a boolean.`);
	}

	return value;
}

function normalizeInteger(
	value: unknown,
	label: string,
	options: { max?: number; min?: number } = {},
): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(numericValue)) {
		throw new Error(`${label} must be an integer.`);
	}
	if (options.min !== undefined && numericValue < options.min) {
		throw new Error(`${label} must be at least ${options.min}.`);
	}
	if (options.max !== undefined && numericValue > options.max) {
		throw new Error(`${label} must be at most ${options.max}.`);
	}

	return numericValue;
}

function normalizeStringList(value: unknown, label: string): string[] | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const values = Array.isArray(value) ? value : [value];
	const normalized = values.map((entry, index) => normalizeRequiredString(entry, `${label}[${index}]`));
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeKeyValueOptions(value: unknown, label: string): string[] | undefined {
	const normalized = normalizeStringList(value, label);
	if (!normalized) {
		return undefined;
	}

	for (const entry of normalized) {
		if (!entry.includes("=")) {
			throw new Error(`${label} entries must be in KEY=VALUE form.`);
		}
	}

	return normalized;
}

function normalizeOutputMode(value: unknown): "raw" | "lines" | "table" | undefined {
	const normalized = normalizeOptionalString(value, "atool outputMode");
	if (!normalized) {
		return undefined;
	}

	const lowerCaseValue = normalized.toLowerCase();
	if (!ATOOL_LIST_OUTPUT_MODES.has(lowerCaseValue)) {
		throw new Error("atool outputMode must be one of: raw, lines, table.");
	}

	return lowerCaseValue as "raw" | "lines" | "table";
}

function createRootCommand(argv: readonly string[]): BpkgTranspiledCommand {
	return {
		argv: [...argv],
		createdAt: Date.now(),
		cwd: "/root",
	};
}

function pushCommonAtoolArgs(
	argv: string[],
	params: {
		archiveFormat?: string;
		config?: string;
		explain?: boolean;
		formatOptions?: readonly string[];
		options?: readonly string[];
		quiet?: boolean;
		simulate?: boolean;
		verbose?: boolean;
		verbosity?: number;
	},
): void {
	if (params.simulate && params.explain) {
		throw new Error("atool simulate=true cannot be combined with explain=true.");
	}

	if (params.simulate) {
		argv.push("--simulate");
	} else if (params.explain) {
		argv.push("--explain");
	}
	if (params.quiet) {
		argv.push("--quiet");
	}
	if (params.verbose) {
		argv.push("--verbose");
	}
	if (params.verbosity !== undefined) {
		argv.push(`--verbosity=${params.verbosity}`);
	}
	if (params.config) {
		argv.push(`--config=${params.config}`);
	}
	if (params.archiveFormat) {
		argv.push(`--format=${params.archiveFormat}`);
	}
	for (const entry of params.options ?? []) {
		argv.push(`--option=${entry}`);
	}
	for (const entry of params.formatOptions ?? []) {
		argv.push(`--format-option=${entry}`);
	}
}

function inferFormatFromPath(filePath: string): string | undefined {
	const normalized = filePath.trim().toLowerCase();
	if (normalized.endsWith(".tar.gz")) {
		return "tar.gz";
	}
	if (normalized.endsWith(".tgz")) {
		return "tar.gz";
	}
	if (normalized.endsWith(".tar.xz")) {
		return "tar.xz";
	}
	if (normalized.endsWith(".zip")) {
		return "zip";
	}
	if (normalized.endsWith(".7z") || normalized.endsWith(".t7z") || normalized.endsWith(".tar.7z")) {
		return "7z";
	}
	return undefined;
}

function isSevenZipFormat(targetPath: string, format: string | undefined): boolean {
	const effectiveFormat = (format ?? inferFormatFromPath(targetPath) ?? "").toLowerCase();
	return effectiveFormat.includes("7z");
}

function buildSevenZipFormatOptions(
	targetPath: string,
	format: string | undefined,
	formatOptions: readonly string[],
	level: number | undefined,
	password: string | undefined,
): string[] {
	if (level === undefined && !password) {
		return [...formatOptions];
	}

	if (!isSevenZipFormat(targetPath, format)) {
		throw new Error("atool level/password are supported only for 7z-family outputs in v1.");
	}

	return [
		...formatOptions,
		...(level !== undefined ? [`-mx=${level}`] : []),
		...(password ? [`-p${password}`] : []),
	];
}

function splitOutputLines(text: string): string[] {
	return text
		.split(/\r?\n/u)
		.map((entry) => entry.trimEnd())
		.filter((entry) => entry.length > 0);
}

function readLongArgValue(argv: readonly string[] | undefined, flagName: string): string | undefined {
	if (!argv || argv.length === 0) {
		return undefined;
	}

	for (let index = 0; index < argv.length; index += 1) {
		const entry = argv[index] ?? "";
		if (entry === flagName) {
			return argv[index + 1];
		}
		if (entry.startsWith(`${flagName}=`)) {
			return entry.slice(flagName.length + 1);
		}
	}

	return undefined;
}

function normalizeArchiveFormatParam(params: Record<string, unknown>): string | undefined {
	return normalizeOptionalString(params.archiveFormat ?? params.format, "atool format");
}

function normalizeCommonParams(params: Record<string, unknown>) {
	return {
		archiveFormat: normalizeArchiveFormatParam(params),
		config: normalizeOptionalString(params.config, "atool config"),
		explain: normalizeBoolean(params.explain, "atool explain") ?? false,
		formatOptions: normalizeStringList(params.formatOptions, "atool formatOptions") ?? [],
		options: normalizeKeyValueOptions(params.options, "atool options") ?? [],
		quiet: normalizeBoolean(params.quiet, "atool quiet") ?? false,
		simulate: normalizeBoolean(params.simulate, "atool simulate") ?? false,
		verbose: normalizeBoolean(params.verbose, "atool verbose") ?? false,
		verbosity: normalizeInteger(params.verbosity, "atool verbosity", { min: 0 }),
	};
}

const atoolPackResponseParser: BpkgBindingResponseParser = async (_result, context) => ({
	archivePath: normalizeRequiredString(context.params.target, "atool target"),
	bindingId: context.bindingId,
	format: normalizeOptionalString(context.params.format, "atool format") ?? inferFormatFromPath(
		normalizeRequiredString(context.params.target, "atool target"),
	),
	kind: "atool-pack",
	paths: normalizeStringList(context.params.paths, "atool paths") ?? [],
	...(normalizeBoolean(context.params.simulate, "atool simulate") ? { simulated: true } : {}),
	...(normalizeBoolean(context.params.explain, "atool explain") ? { explained: true } : {}),
});

const atoolUnpackResponseParser: BpkgBindingResponseParser = async (result, context) => {
	const outputPathFile = readLongArgValue(context.transpiled.argv, "--save-outdir");
	const extractedTo = outputPathFile
		? (await context.readFile(outputPathFile).catch(() => "")).trim() || undefined
		: undefined;

	return {
		archive: normalizeRequiredString(context.params.archive, "atool archive"),
		bindingId: context.bindingId,
		extractedTo,
		kind: "atool-unpack",
		lines: splitOutputLines(result.stdout),
		raw: result.stdout,
		...(normalizeOptionalString(context.params.to, "atool to") ? { requestedOutputPath: normalizeRequiredString(context.params.to, "atool to") } : {}),
	};
};

const atoolListResponseParser: BpkgBindingResponseParser = async (result, context) => {
	const lines = splitOutputLines(result.stdout);
	const outputMode = normalizeOutputMode(context.params.outputMode) ?? "raw";

	return {
		archive: normalizeRequiredString(context.params.archive, "atool archive"),
		bindingId: context.bindingId,
		kind: "atool-list",
		lines,
		outputMode,
		raw: result.stdout,
		...(outputMode === "table"
			? {
				rows: lines.map((text, index) => ({
					index,
					text,
				})),
			}
			: {}),
	};
};

const atoolCatResponseParser: BpkgBindingResponseParser = async (result, context) => ({
	archive: normalizeRequiredString(context.params.archive, "atool archive"),
	bindingId: context.bindingId,
	file: normalizeRequiredString(context.params.file, "atool file"),
	kind: "atool-cat",
	lines: splitOutputLines(result.stdout),
	text: result.stdout,
});

const atoolDiffResponseParser: BpkgBindingResponseParser = async (result, context) => ({
	bindingId: context.bindingId,
	first: normalizeRequiredString(context.params.first, "atool first"),
	kind: "atool-diff",
	lines: splitOutputLines(result.stdout),
	raw: result.stdout,
	second: normalizeRequiredString(context.params.second, "atool second"),
});

const atoolRepackResponseParser: BpkgBindingResponseParser = async (_result, context) => ({
	bindingId: context.bindingId,
	format: normalizeOptionalString(context.params.format, "atool format") ?? inferFormatFromPath(
		normalizeRequiredString(context.params.target, "atool target"),
	),
	kind: "atool-repack",
	source: normalizeRequiredString(context.params.source, "atool source"),
	target: normalizeRequiredString(context.params.target, "atool target"),
	...(normalizeBoolean(context.params.simulate, "atool simulate") ? { simulated: true } : {}),
	...(normalizeBoolean(context.params.explain, "atool explain") ? { explained: true } : {}),
});

export const atoolBindings = defineBindings({
	package: "@bpkg/atool",
	description: "atool archive helpers running inside the selected bpkg box.",
	dependency: {
		pacman: ["atool", "tar", "gzip", "bzip2", "xz", "zip", "unzip", "7zip", "diffutils"],
	},
	id: "atool",
	bindings: {
		pack: {
			description: "Create an archive with apack inside the selected bpkg box.",
			parameters: {
				target: {
					type: "string",
					description: "Target archive path inside the selected box.",
					example: "/root/backup.7z",
					required: true,
				},
				paths: {
					type: "string[]",
					description: "Input file or directory paths inside the selected box.",
					example: "/root/logs,/root/configs/nginx.conf",
					required: true,
				},
				format: {
					type: "string",
					description: "Optional archive format override for apack.",
					example: "7z",
				},
				overwrite: {
					type: "boolean",
					description: "Overwrite an existing target archive when true.",
					example: "true",
				},
				nullSeparated: {
					type: "boolean",
					description: "Read paths as null-separated when piping from stdin; mostly useful for advanced calls.",
					example: "true",
				},
				level: {
					type: "number",
					description: "Compression level sugar for 7z-family outputs only in v1.",
					example: "9",
				},
				password: {
					type: "string",
					description: "Password sugar for 7z-family outputs only in v1.",
					example: "john_secret_pass",
				},
				simulate: {
					type: "boolean",
					description: "Run in simulation mode and print the underlying archiver command.",
					example: "true",
				},
				explain: {
					type: "boolean",
					description: "Print commands executed by atool.",
					example: "true",
				},
				quiet: {
					type: "boolean",
					description: "Decrease verbosity by one.",
					example: "true",
				},
				verbose: {
					type: "boolean",
					description: "Increase verbosity by one.",
					example: "true",
				},
				verbosity: {
					type: "number",
					description: "Explicit atool verbosity level.",
					example: "1",
				},
				config: {
					type: "string",
					description: "Optional path to an atool config file inside the box.",
					example: "/root/.atoolrc",
				},
				options: {
					type: "string[]",
					description: "Repeated KEY=VALUE overrides forwarded as --option=KEY=VALUE.",
					example: "use_file=1,default_verbosity=0",
				},
				formatOptions: {
					type: "string[]",
					description: "Repeated archiver-native options forwarded as --format-option=...",
					example: "-mx=9,-mhe=on",
				},
			},
			responseParser: atoolPackResponseParser,
		},
		unpack: {
			description: "Extract an archive with aunpack inside the selected bpkg box.",
			defaultParameterName: "archive",
			parameters: {
				archive: {
					type: "string",
					description: "Archive path inside the selected box.",
					example: "/root/data.zip",
					required: true,
				},
				files: {
					type: "string[]",
					description: "Optional file paths inside the archive to extract.",
					example: "docs/readme.txt,docs/changelog.txt",
				},
				to: {
					type: "string",
					description: "Optional extraction target path inside the box.",
					example: "/root/extracted_data",
				},
				each: {
					type: "boolean",
					description: "Pass --each to aunpack.",
					example: "true",
				},
				overwrite: {
					type: "boolean",
					description: "Allow overwriting local files while extracting.",
					example: "true",
				},
				subdir: {
					type: "boolean",
					description: "Always create a subdirectory during extraction.",
					example: "true",
				},
				archiveFormat: {
					type: "string",
					description: "Optional archive format override for aunpack.",
					example: "zip",
				},
				simulate: {
					type: "boolean",
					description: "Run in simulation mode and print the underlying command.",
					example: "true",
				},
				explain: {
					type: "boolean",
					description: "Print commands executed by atool.",
					example: "true",
				},
				quiet: {
					type: "boolean",
					description: "Decrease verbosity by one.",
					example: "true",
				},
				verbose: {
					type: "boolean",
					description: "Increase verbosity by one.",
					example: "true",
				},
				verbosity: {
					type: "number",
					description: "Explicit atool verbosity level.",
					example: "1",
				},
				config: {
					type: "string",
					description: "Optional path to an atool config file inside the box.",
					example: "/root/.atoolrc",
				},
				options: {
					type: "string[]",
					description: "Repeated KEY=VALUE overrides forwarded as --option=KEY=VALUE.",
					example: "use_file=1,default_verbosity=0",
				},
				formatOptions: {
					type: "string[]",
					description: "Repeated archiver-native options forwarded as --format-option=...",
					example: "-o",
				},
			},
			responseParser: atoolUnpackResponseParser,
		},
		list: {
			description: "List archive contents with als inside the selected bpkg box.",
			defaultParameterName: "archive",
			parameters: {
				archive: {
					type: "string",
					description: "Archive path inside the selected box.",
					example: "/root/bundle.tar.xz",
					required: true,
				},
				files: {
					type: "string[]",
					description: "Optional specific files to list inside the archive.",
					example: "docs/readme.txt",
				},
				archiveFormat: {
					type: "string",
					description: "Optional archive format override for als.",
					example: "tar.xz",
				},
				outputMode: {
					type: "string",
					description: "Requested result mode: raw, lines, or table wrappers.",
					example: "table",
				},
				simulate: {
					type: "boolean",
					description: "Run in simulation mode and print the underlying command.",
					example: "true",
				},
				explain: {
					type: "boolean",
					description: "Print commands executed by atool.",
					example: "true",
				},
				quiet: {
					type: "boolean",
					description: "Decrease verbosity by one.",
					example: "true",
				},
				verbose: {
					type: "boolean",
					description: "Increase verbosity by one.",
					example: "true",
				},
				verbosity: {
					type: "number",
					description: "Explicit atool verbosity level.",
					example: "1",
				},
				config: {
					type: "string",
					description: "Optional path to an atool config file inside the box.",
					example: "/root/.atoolrc",
				},
				options: {
					type: "string[]",
					description: "Repeated KEY=VALUE overrides forwarded as --option=KEY=VALUE.",
					example: "use_file=1",
				},
				formatOptions: {
					type: "string[]",
					description: "Repeated archiver-native options forwarded as --format-option=...",
					example: "-slt",
				},
			},
			responseParser: atoolListResponseParser,
		},
		cat: {
			description: "Read a single file from an archive with acat inside the selected bpkg box.",
			parameters: {
				archive: {
					type: "string",
					description: "Archive path inside the selected box.",
					example: "/root/docs.zip",
					required: true,
				},
				file: {
					type: "string",
					description: "Path to a file inside the archive.",
					example: "readme.txt",
					required: true,
				},
				archiveFormat: {
					type: "string",
					description: "Optional archive format override for acat.",
					example: "zip",
				},
				simulate: {
					type: "boolean",
					description: "Run in simulation mode and print the underlying command.",
					example: "true",
				},
				explain: {
					type: "boolean",
					description: "Print commands executed by atool.",
					example: "true",
				},
				quiet: {
					type: "boolean",
					description: "Decrease verbosity by one.",
					example: "true",
				},
				verbose: {
					type: "boolean",
					description: "Increase verbosity by one.",
					example: "true",
				},
				verbosity: {
					type: "number",
					description: "Explicit atool verbosity level.",
					example: "1",
				},
				config: {
					type: "string",
					description: "Optional path to an atool config file inside the box.",
					example: "/root/.atoolrc",
				},
				options: {
					type: "string[]",
					description: "Repeated KEY=VALUE overrides forwarded as --option=KEY=VALUE.",
					example: "use_file=1",
				},
				formatOptions: {
					type: "string[]",
					description: "Repeated archiver-native options forwarded as --format-option=...",
					example: "-slt",
				},
			},
			responseParser: atoolCatResponseParser,
		},
		diff: {
			description: "Diff two archives with adiff inside the selected bpkg box.",
			parameters: {
				first: {
					type: "string",
					description: "First archive path inside the selected box.",
					example: "/root/old_version.tar.gz",
					required: true,
				},
				second: {
					type: "string",
					description: "Second archive path inside the selected box.",
					example: "/root/new_version.tar.gz",
					required: true,
				},
				diffArgs: {
					type: "string[]",
					description: "Optional diff arguments forwarded via the args_diff atool option.",
					example: "-ru,-N",
				},
				simulate: {
					type: "boolean",
					description: "Run in simulation mode and print the underlying command.",
					example: "true",
				},
				explain: {
					type: "boolean",
					description: "Print commands executed by atool.",
					example: "true",
				},
				quiet: {
					type: "boolean",
					description: "Decrease verbosity by one.",
					example: "true",
				},
				verbose: {
					type: "boolean",
					description: "Increase verbosity by one.",
					example: "true",
				},
				verbosity: {
					type: "number",
					description: "Explicit atool verbosity level.",
					example: "1",
				},
				config: {
					type: "string",
					description: "Optional path to an atool config file inside the box.",
					example: "/root/.atoolrc",
				},
				options: {
					type: "string[]",
					description: "Repeated KEY=VALUE overrides forwarded as --option=KEY=VALUE.",
					example: "use_file=1",
				},
			},
			responseParser: atoolDiffResponseParser,
		},
		repack: {
			description: "Repack an archive to a new target with arepack inside the selected bpkg box.",
			parameters: {
				source: {
					type: "string",
					description: "Source archive path inside the selected box.",
					example: "/root/old.tar.gz",
					required: true,
				},
				target: {
					type: "string",
					description: "Target archive path inside the selected box.",
					example: "/root/new.tar.7z",
					required: true,
				},
				format: {
					type: "string",
					description: "Optional archive format override for arepack.",
					example: "7z",
				},
				level: {
					type: "number",
					description: "Compression level sugar for 7z-family outputs only in v1.",
					example: "9",
				},
				password: {
					type: "string",
					description: "Password sugar for 7z-family outputs only in v1.",
					example: "john_secret_pass",
				},
				simulate: {
					type: "boolean",
					description: "Run in simulation mode and print the underlying command.",
					example: "true",
				},
				explain: {
					type: "boolean",
					description: "Print commands executed by atool.",
					example: "true",
				},
				quiet: {
					type: "boolean",
					description: "Decrease verbosity by one.",
					example: "true",
				},
				verbose: {
					type: "boolean",
					description: "Increase verbosity by one.",
					example: "true",
				},
				verbosity: {
					type: "number",
					description: "Explicit atool verbosity level.",
					example: "1",
				},
				config: {
					type: "string",
					description: "Optional path to an atool config file inside the box.",
					example: "/root/.atoolrc",
				},
				options: {
					type: "string[]",
					description: "Repeated KEY=VALUE overrides forwarded as --option=KEY=VALUE.",
					example: "use_file=1,default_verbosity=0",
				},
				formatOptions: {
					type: "string[]",
					description: "Repeated archiver-native options forwarded as --format-option=...",
					example: "-mx=9,-mhe=on",
				},
			},
			responseParser: atoolRepackResponseParser,
		},
	},
	transformers: {
		async pack(params) {
			const target = normalizeRequiredString(params.target, "atool target");
			const paths = normalizeStringList(params.paths, "atool paths");
			if (!paths || paths.length === 0) {
				throw new Error("atool pack requires at least one input path.");
			}

			const { archiveFormat, config, explain, formatOptions, options, quiet, simulate, verbose, verbosity } = normalizeCommonParams(params);
			const overwrite = normalizeBoolean(params.overwrite, "atool overwrite") ?? false;
			const nullSeparated = normalizeBoolean(params.nullSeparated, "atool nullSeparated") ?? false;
			const level = normalizeInteger(params.level, "atool level", { min: 0, max: 9 });
			const password = normalizeOptionalString(params.password, "atool password");
			const argv = ["apack"];
			pushCommonAtoolArgs(argv, {
				archiveFormat,
				config,
				explain,
				formatOptions: buildSevenZipFormatOptions(target, archiveFormat, formatOptions, level, password),
				options,
				quiet,
				simulate,
				verbose,
				verbosity,
			});
			if (overwrite) {
				argv.push("--force");
			}
			if (nullSeparated) {
				argv.push("--null");
			}
			argv.push(target, ...paths);
			return createRootCommand(argv);
		},
		async unpack(params) {
			const archive = normalizeRequiredString(params.archive, "atool archive");
			const files = normalizeStringList(params.files, "atool files") ?? [];
			const to = normalizeOptionalString(params.to, "atool to");
			const each = normalizeBoolean(params.each, "atool each") ?? false;
			const overwrite = normalizeBoolean(params.overwrite, "atool overwrite") ?? false;
			const subdir = normalizeBoolean(params.subdir, "atool subdir") ?? false;
			const { archiveFormat, config, explain, formatOptions, options, quiet, simulate, verbose, verbosity } = normalizeCommonParams(params);
			const saveOutdirPath = `/tmp/iscan-atool-unpack-outdir-${Date.now().toString(36)}.txt`;
			const argv = ["aunpack"];
			pushCommonAtoolArgs(argv, {
				archiveFormat,
				config,
				explain,
				formatOptions,
				options,
				quiet,
				simulate,
				verbose,
				verbosity,
			});
			if (to) {
				argv.push(`--extract-to=${to}`);
			}
			if (each) {
				argv.push("--each");
			}
			if (overwrite) {
				argv.push("--force");
			}
			if (subdir) {
				argv.push("--subdir");
			}
			if (!to) {
				argv.push(`--save-outdir=${saveOutdirPath}`);
			}
			argv.push(archive, ...files);
			return createRootCommand(argv);
		},
		async list(params) {
			const archive = normalizeRequiredString(params.archive, "atool archive");
			const files = normalizeStringList(params.files, "atool files") ?? [];
			normalizeOutputMode(params.outputMode);
			const { archiveFormat, config, explain, formatOptions, options, quiet, simulate, verbose, verbosity } = normalizeCommonParams(params);
			const argv = ["als"];
			pushCommonAtoolArgs(argv, {
				archiveFormat,
				config,
				explain,
				formatOptions,
				options,
				quiet,
				simulate,
				verbose,
				verbosity,
			});
			argv.push(archive, ...files);
			return createRootCommand(argv);
		},
		async cat(params) {
			const archive = normalizeRequiredString(params.archive, "atool archive");
			const file = normalizeRequiredString(params.file, "atool file");
			const { archiveFormat, config, explain, formatOptions, options, quiet, simulate, verbose, verbosity } = normalizeCommonParams(params);
			const argv = ["acat"];
			pushCommonAtoolArgs(argv, {
				archiveFormat,
				config,
				explain,
				formatOptions,
				options,
				quiet,
				simulate,
				verbose,
				verbosity,
			});
			argv.push(archive, file);
			return createRootCommand(argv);
		},
		async diff(params) {
			const first = normalizeRequiredString(params.first, "atool first");
			const second = normalizeRequiredString(params.second, "atool second");
			const diffArgs = normalizeStringList(params.diffArgs, "atool diffArgs") ?? [];
			const { config, explain, options, quiet, simulate, verbose, verbosity } = normalizeCommonParams(params);
			const argv = ["adiff"];
			pushCommonAtoolArgs(argv, {
				config,
				explain,
				options: [
					...options,
					...(diffArgs.length > 0 ? [`args_diff=${diffArgs.join(" ")}`] : []),
				],
				quiet,
				simulate,
				verbose,
				verbosity,
			});
			argv.push(first, second);
			return createRootCommand(argv);
		},
		async repack(params) {
			const source = normalizeRequiredString(params.source, "atool source");
			const target = normalizeRequiredString(params.target, "atool target");
			const { archiveFormat, config, explain, formatOptions, options, quiet, simulate, verbose, verbosity } = normalizeCommonParams(params);
			const level = normalizeInteger(params.level, "atool level", { min: 0, max: 9 });
			const password = normalizeOptionalString(params.password, "atool password");
			const argv = ["arepack"];
			pushCommonAtoolArgs(argv, {
				archiveFormat,
				config,
				explain,
				formatOptions: buildSevenZipFormatOptions(target, archiveFormat, formatOptions, level, password),
				options,
				quiet,
				simulate,
				verbose,
				verbosity,
			});
			argv.push(source, target);
			return createRootCommand(argv);
		},
	},
});

export default atoolBindings;