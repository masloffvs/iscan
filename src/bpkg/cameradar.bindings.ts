import {
	defineBindings,
	type BpkgBindingPrepare,
	type BpkgBindingResponseParser,
	type BpkgPrivilegeLevel,
	type BpkgTranspiledCommand,
} from "./define-bindings";
import { defineNotebookTypeOverlay } from "../modules/module";

const CAMERADAR_BOOTSTRAP_VERSION = "v6.1.1";
const CAMERADAR_BINARY_PATH = "/root/.local/bin/cameradar";
const CAMERADAR_TIMEOUT_BINARY_PATH = "/usr/bin/timeout";
const CAMERADAR_VERSION_STAMP_PATH = "/root/.local/share/iscan/cameradar.version";
const CAMERADAR_MODULE_SPEC = `github.com/Ullaakut/cameradar/v6/cmd/cameradar@${CAMERADAR_BOOTSTRAP_VERSION}`;
const CAMERADAR_GO_PATH = "/root/.local/go";
const CAMERADAR_GO_MOD_CACHE_PATH = "/root/.cache/go/pkg/mod";
const CAMERADAR_GO_BUILD_CACHE_PATH = "/root/.cache/go/build";
const CAMERADAR_DEFAULT_PORTS = ["554", "5554", "8554", "http"] as const;
const CAMERADAR_DEFAULT_PROCESS_TIMEOUT = "120s";
const CAMERADAR_SUPPORTED_SCANNERS = new Set(["nmap", "masscan"]);
const CAMERADAR_SUPPORTED_UI_MODES = new Set(["auto", "plain", "tui"]);
const CAMERADAR_NO_STREAM_FOUND_PATTERN = /\bno stream found\b/iu;
const CAMERADAR_PROCESS_TIMEOUT_PATTERN = /Error:\s+cameradar process timed out after\s+/iu;
const RTSP_URL_PATTERN = /\brtsps?:\/\/[^\s"'<>]+/giu;
const CAMERADAR_SCAN_NOTEBOOK_TYPE_OVERLAY = defineNotebookTypeOverlay("src/bpkg/cameradar.scan.h.ts");

const CAMERADAR_BOOTSTRAP_ENV = {
	GOCACHE: CAMERADAR_GO_BUILD_CACHE_PATH,
	GOENV: "off",
	GOMODCACHE: CAMERADAR_GO_MOD_CACHE_PATH,
	GOPATH: CAMERADAR_GO_PATH,
} as const;

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
		throw new Error(`${label} must be >= ${options.min}.`);
	}

	if (options.max !== undefined && numericValue > options.max) {
		throw new Error(`${label} must be <= ${options.max}.`);
	}

	return numericValue;
}

function normalizeOptionalStringArray(value: unknown, label: string): string[] | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const values = Array.isArray(value) ? value : [value];
	const normalizedValues = values.map((entry, index) => normalizeRequiredString(entry, `${label}[${index}]`));
	return normalizedValues.length > 0 ? normalizedValues : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeTargetInputs(params: Record<string, unknown>): string[] {
	const targets = uniqueStrings([
		...(normalizeOptionalString(params.target, "Cameradar target") ? [normalizeRequiredString(params.target, "Cameradar target")] : []),
		...(normalizeOptionalStringArray(params.targets, "Cameradar targets") ?? []),
	]);

	if (targets.length === 0) {
		throw new Error("Cameradar scan requires at least one target or targets entry.");
	}

	return targets;
}

function normalizeOptionalPort(value: unknown, label: string): string | undefined {
	const normalized = normalizeOptionalString(value, label);
	return normalized ? normalized.replace(/\s+/gu, "") : undefined;
}

function normalizeOptionalPortArray(value: unknown, label: string): string[] | undefined {
	const normalized = normalizeOptionalStringArray(value, label);
	return normalized?.map((entry) => entry.replace(/\s+/gu, "")).filter(Boolean);
}

function normalizePortInputs(params: Record<string, unknown>): string[] {
	const ports = uniqueStrings([
		...(normalizeOptionalPort(params.port, "Cameradar port") ? [normalizeOptionalPort(params.port, "Cameradar port") as string] : []),
		...(normalizeOptionalPortArray(params.ports, "Cameradar ports") ?? []),
	]);

	return ports.length > 0 ? ports : [...CAMERADAR_DEFAULT_PORTS];
}

function normalizeScanner(value: unknown): string | undefined {
	const normalized = normalizeOptionalString(value, "Cameradar scanner");
	if (!normalized) {
		return undefined;
	}

	const lowerCaseValue = normalized.toLowerCase();
	if (!CAMERADAR_SUPPORTED_SCANNERS.has(lowerCaseValue)) {
		throw new Error("Cameradar scanner must be one of: nmap, masscan.");
	}

	return lowerCaseValue;
}

function normalizeUiMode(value: unknown): string | undefined {
	const normalized = normalizeOptionalString(value, "Cameradar ui");
	if (!normalized) {
		return undefined;
	}

	const lowerCaseValue = normalized.toLowerCase();
	if (!CAMERADAR_SUPPORTED_UI_MODES.has(lowerCaseValue)) {
		throw new Error("Cameradar ui must be one of: auto, plain, tui.");
	}

	return lowerCaseValue;
}

function splitOutputLines(text: string): string[] {
	return text
		.split(/\r?\n/u)
		.map((entry) => entry.trimEnd())
		.filter((entry) => entry.trim().length > 0);
}

function escapeShellArg(value: string): string {
	return `'${value.replace(/'/gu, `"'"'`)}'`;
}

function dirnameOf(filePath: string): string {
	const normalized = normalizeRequiredString(filePath, "Cameradar path");
	const separatorIndex = normalized.lastIndexOf("/");
	if (separatorIndex < 0) {
		return ".";
	}

	return separatorIndex === 0 ? "/" : normalized.slice(0, separatorIndex);
}

function buildBootstrappedShellCommand(
	commandArgv: readonly string[],
	options: { preExecCommands?: readonly string[] } = {},
): string {
	const execCommand = `exec ${[escapeShellArg(CAMERADAR_BINARY_PATH), ...commandArgv.map((arg) => escapeShellArg(arg))].join(" ")}`;
	return buildBootstrappedShellScript([execCommand], options);
}

function buildBootstrappedShellScript(
	commands: readonly string[],
	options: { preExecCommands?: readonly string[] } = {},
): string {
	return [
		"set -eu",
		`CAMERADAR_BIN=${escapeShellArg(CAMERADAR_BINARY_PATH)}`,
		`CAMERADAR_STAMP=${escapeShellArg(CAMERADAR_VERSION_STAMP_PATH)}`,
		`CAMERADAR_VERSION=${escapeShellArg(CAMERADAR_BOOTSTRAP_VERSION)}`,
		`CAMERADAR_MODULE=${escapeShellArg(CAMERADAR_MODULE_SPEC)}`,
		'if [ ! -x "$CAMERADAR_BIN" ] || [ ! -f "$CAMERADAR_STAMP" ] || [ "$(cat "$CAMERADAR_STAMP" 2>/dev/null || true)" != "$CAMERADAR_VERSION" ]; then mkdir -p "$(dirname "$CAMERADAR_BIN")" "$(dirname "$CAMERADAR_STAMP")" "$GOPATH" "$GOMODCACHE" "$GOCACHE"; GOBIN="$(dirname "$CAMERADAR_BIN")" go install "$CAMERADAR_MODULE"; printf "%s\n" "$CAMERADAR_VERSION" > "$CAMERADAR_STAMP"; fi',
		...(options.preExecCommands ?? []),
		...commands,
	].join("; ");
}

function createBootstrappedRootCommand(
	commandArgv: readonly string[],
	options: {
		preExecCommands?: readonly string[];
		privilegeLevel?: BpkgPrivilegeLevel;
	} = {},
): BpkgTranspiledCommand {
	return {
		argv: ["/bin/sh", "-lc", buildBootstrappedShellCommand(commandArgv, options)],
		createdAt: Date.now(),
		cwd: "/root",
		env: { ...CAMERADAR_BOOTSTRAP_ENV },
		privilegeLevel: options.privilegeLevel ?? "sandbox-ro",
	};
}

function parseVersionOutput(text: string): {
	buildDate?: string;
	commit?: string;
	nmapVersion?: string;
	version?: string;
} {
	const metadata: {
		buildDate?: string;
		commit?: string;
		nmapVersion?: string;
		version?: string;
	} = {};

	for (const line of splitOutputLines(text)) {
		const separatorIndex = line.indexOf(":");
		if (separatorIndex < 0) {
			continue;
		}

		const key = line.slice(0, separatorIndex).trim().toLowerCase();
		const value = line.slice(separatorIndex + 1).trim();
		if (value.length === 0) {
			continue;
		}

		switch (key) {
			case "version":
				metadata.version = value;
				break;
			case "commit":
				metadata.commit = value;
				break;
			case "build date":
				metadata.buildDate = value;
				break;
			case "nmap":
				metadata.nmapVersion = value;
				break;
		}
	}

	return metadata;
}

function parseRtspUrl(urlText: string, title?: string): Record<string, unknown> {
	try {
		const parsed = new URL(urlText);
		const port = parsed.port ? Number.parseInt(parsed.port, 10) : undefined;
		const route = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : undefined;
		const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
		const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

		return {
			...(parsed.hostname ? { address: parsed.hostname } : {}),
			...(title ? { title } : {}),
			...(route ? { route } : {}),
			...(parsed.protocol ? { scheme: parsed.protocol.replace(/:$/u, "") } : {}),
			...(Number.isFinite(port) ? { port } : {}),
			...(username ? { username } : {}),
			...(password ? { password } : {}),
			hasCredentials: Boolean(username || password),
			url: urlText,
		};
	} catch {
		return {
			...(title ? { title } : {}),
			url: urlText,
		};
	}
	}

function mergeUniqueStreams(
	streams: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown>[] {
	const deduplicated = new Map<string, Record<string, unknown>>();

	for (const stream of streams) {
		const streamUrl = typeof stream.url === "string" ? stream.url : undefined;
		if (!streamUrl) {
			continue;
		}

		deduplicated.set(streamUrl, {
			...(deduplicated.get(streamUrl) ?? {}),
			...stream,
		});
	}

	return [...deduplicated.values()];
}

function parseM3uPlaylist(content: string): Record<string, unknown>[] {
	const streams: Record<string, unknown>[] = [];
	let pendingTitle: string | undefined;

	for (const rawLine of content.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}

		if (line.startsWith("#EXTINF:")) {
			const separatorIndex = line.indexOf(",");
			pendingTitle = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() || undefined : undefined;
			continue;
		}

		if (line.startsWith("#")) {
			continue;
		}

		if (/^rtsps?:\/\//iu.test(line)) {
			streams.push(parseRtspUrl(line, pendingTitle));
		}

		pendingTitle = undefined;
	}

	return mergeUniqueStreams(streams);
}

function extractRtspStreams(text: string): Record<string, unknown>[] {
	const matches = text.match(RTSP_URL_PATTERN) ?? [];
	return mergeUniqueStreams(uniqueStrings(matches).map((urlText) => parseRtspUrl(urlText)));
}

function isNoStreamFoundOutput(text: string): boolean {
	return CAMERADAR_NO_STREAM_FOUND_PATTERN.test(text);
}

function hasCompletedScanSummary(text: string): boolean {
	return /(^|\n)Accessible streams:/u.test(text)
		|| /\[DONE\]\s+Scan targets:\s+Scan complete/iu.test(text);
}

function isProcessTimedOutOutput(text: string): boolean {
	return CAMERADAR_PROCESS_TIMEOUT_PATTERN.test(text);
}

function buildTimedCameradarCommandText(
	target: string,
	sharedArgv: readonly string[],
	processTimeout: string,
): string {
	return [
		escapeShellArg(CAMERADAR_TIMEOUT_BINARY_PATH),
		escapeShellArg("-k"),
		escapeShellArg("5s"),
		escapeShellArg(processTimeout),
		escapeShellArg(CAMERADAR_BINARY_PATH),
		escapeShellArg("--targets"),
		escapeShellArg(target),
		...sharedArgv.map((arg) => escapeShellArg(arg)),
	].join(" ");
}

function buildTimedOutTargetMessage(target: string, processTimeout: string): string {
	return `Error: cameradar process timed out after ${processTimeout} for target ${target}`;
}

function buildScanCommand(params: Record<string, unknown>): BpkgTranspiledCommand {
	const targets = normalizeTargetInputs(params);
	const ports = normalizePortInputs(params);
	const customRoutes = normalizeOptionalString(params.customRoutes, "Cameradar customRoutes");
	const customCredentials = normalizeOptionalString(params.customCredentials, "Cameradar customCredentials");
	const scanner = normalizeScanner(params.scanner) ?? "nmap";
	const scanSpeed = normalizeInteger(params.scanSpeed, "Cameradar scanSpeed", { min: 0, max: 5 }) ?? 4;
	const attackInterval = normalizeOptionalString(params.attackInterval, "Cameradar attackInterval");
	const timeout = normalizeOptionalString(params.timeout, "Cameradar timeout") ?? "2s";
	const processTimeout = normalizeOptionalString(params.processTimeout, "Cameradar processTimeout")
		?? CAMERADAR_DEFAULT_PROCESS_TIMEOUT;
	const skipScan = normalizeBoolean(params.skipScan, "Cameradar skipScan") ?? false;
	const debug = normalizeBoolean(params.debug, "Cameradar debug") ?? false;
	const ui = normalizeUiMode(params.ui) ?? "plain";
	const outputPath = normalizeOptionalString(params.outputPath, "Cameradar outputPath");

	const sharedArgv: string[] = [];
	for (const port of ports) {
		sharedArgv.push("--ports", port);
	}
	if (customRoutes) {
		sharedArgv.push("--custom-routes", customRoutes);
	}
	if (customCredentials) {
		sharedArgv.push("--custom-credentials", customCredentials);
	}
	sharedArgv.push("--scanner", scanner, "--scan-speed", String(scanSpeed), "--timeout", timeout, "--ui", ui);
	if (attackInterval) {
		sharedArgv.push("--attack-interval", attackInterval);
	}
	if (skipScan) {
		sharedArgv.push("--skip-scan");
	}
	if (debug) {
		sharedArgv.push("--debug");
	}
	if (outputPath) {
		sharedArgv.push("--output", outputPath);
	}

	if (targets.length === 1) {
		const target = targets[0] as string;
		const commandText = buildTimedCameradarCommandText(target, sharedArgv, processTimeout);
		const timeoutMessage = buildTimedOutTargetMessage(target, processTimeout);
		return {
			argv: ["/bin/sh", "-lc", buildBootstrappedShellScript([
				`${commandText} || scan_exit=$?`,
				'scan_exit=${scan_exit:-0}',
				`if [ "$scan_exit" -eq 124 ] || [ "$scan_exit" -eq 137 ]; then printf "%s\\n" ${escapeShellArg(timeoutMessage)} >&2; scan_exit=1; fi`,
				'exit "$scan_exit"',
			], {
			preExecCommands: outputPath ? [`mkdir -p ${escapeShellArg(dirnameOf(outputPath))}`] : undefined,
			})],
			createdAt: Date.now(),
			cwd: "/root",
			env: { ...CAMERADAR_BOOTSTRAP_ENV },
			privilegeLevel: scanner === "masscan" && !skipScan ? "host-privileged" : "sandbox-ro",
		};
	}

	const loopScript = [
		"scan_status=1",
		...targets.map((target) => {
			const commandText = buildTimedCameradarCommandText(target, sharedArgv, processTimeout);
			const timeoutMessage = buildTimedOutTargetMessage(target, processTimeout);
			return [
			`${commandText} || scan_exit=$?`,
			'scan_exit=${scan_exit:-0}',
			`if [ "$scan_exit" -eq 124 ] || [ "$scan_exit" -eq 137 ]; then printf "%s\\n" ${escapeShellArg(timeoutMessage)} >&2; scan_exit=1; fi`,
			'if [ "$scan_exit" -eq 0 ]; then scan_status=0; fi',
			'if [ "$scan_exit" -ne 0 ] && [ "$scan_exit" -ne 1 ]; then exit "$scan_exit"; fi',
			"unset scan_exit",
		].join("; ");
		}),
		"exit \"$scan_status\"",
	];

	return {
		argv: ["/bin/sh", "-lc", buildBootstrappedShellScript(loopScript, {
			preExecCommands: outputPath ? [`mkdir -p ${escapeShellArg(dirnameOf(outputPath))}`] : undefined,
		})],
		createdAt: Date.now(),
		cwd: "/root",
		env: { ...CAMERADAR_BOOTSTRAP_ENV },
		privilegeLevel: scanner === "masscan" && !skipScan ? "host-privileged" : "sandbox-ro",
	};
}

const cameradarScanPrepare: BpkgBindingPrepare = async (context) => {
	const customRoutes = normalizeOptionalString(context.params.customRoutes, "Cameradar customRoutes");
	if (customRoutes && !(await context.boxFileExists(customRoutes))) {
		throw new Error(`Cameradar custom routes file '${customRoutes}' was not found inside the selected box.`);
	}

	const customCredentials = normalizeOptionalString(context.params.customCredentials, "Cameradar customCredentials");
	if (customCredentials && !(await context.boxFileExists(customCredentials))) {
		throw new Error(`Cameradar custom credentials file '${customCredentials}' was not found inside the selected box.`);
	}

	for (const target of normalizeTargetInputs(context.params)) {
		if (!target.startsWith("/")) {
			continue;
		}

		if (!(await context.boxFileExists(target))) {
			throw new Error(`Cameradar targets file '${target}' was not found inside the selected box.`);
		}
	}
};

const cameradarScanResponseParser: BpkgBindingResponseParser = async (result, context) => {
	const targets = normalizeTargetInputs(context.params);
	const ports = normalizePortInputs(context.params);
	const customRoutes = normalizeOptionalString(context.params.customRoutes, "Cameradar customRoutes");
	const customCredentials = normalizeOptionalString(context.params.customCredentials, "Cameradar customCredentials");
	const scanner = normalizeScanner(context.params.scanner) ?? "nmap";
	const scanSpeed = normalizeInteger(context.params.scanSpeed, "Cameradar scanSpeed", { min: 0, max: 5 }) ?? 4;
	const attackInterval = normalizeOptionalString(context.params.attackInterval, "Cameradar attackInterval");
	const timeout = normalizeOptionalString(context.params.timeout, "Cameradar timeout") ?? "2s";
	const processTimeout = normalizeOptionalString(context.params.processTimeout, "Cameradar processTimeout")
		?? CAMERADAR_DEFAULT_PROCESS_TIMEOUT;
	const skipScan = normalizeBoolean(context.params.skipScan, "Cameradar skipScan") ?? false;
	const debug = normalizeBoolean(context.params.debug, "Cameradar debug") ?? false;
	const ui = normalizeUiMode(context.params.ui) ?? "plain";
	const outputPath = normalizeOptionalString(context.params.outputPath, "Cameradar outputPath");
	const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
	const outputContent = outputPath
		? await context.readFile(outputPath).catch(() => undefined)
		: undefined;
	const playlistStreams = outputContent ? parseM3uPlaylist(outputContent) : [];
	const loggedStreams = extractRtspStreams(combinedOutput);
	const streams = mergeUniqueStreams([...playlistStreams, ...loggedStreams]);
	const timedOut = isProcessTimedOutOutput(combinedOutput);
	const completedWithSummary = result.exitCode === 1 && hasCompletedScanSummary(combinedOutput);
	const completedWithoutStreams = result.exitCode === 1
		&& streams.length === 0
		&& isNoStreamFoundOutput(combinedOutput);
	const reason = timedOut
		? "timed-out"
		: (completedWithoutStreams ? "no-stream-found" : undefined);

	if (result.exitCode !== 0 && !completedWithoutStreams && !completedWithSummary && !timedOut && streams.length === 0) {
		throw new Error(
			`Cameradar scan failed with exit code ${result.exitCode}.\n${combinedOutput.trim() || "Cameradar scan failed without output."}`,
		);
	}

	return {
		bindingId: context.bindingId,
		bootstrapVersion: CAMERADAR_BOOTSTRAP_VERSION,
		...(customCredentials ? { customCredentials } : {}),
		...(customRoutes ? { customRoutes } : {}),
		debug,
		exitCode: result.exitCode,
		kind: "cameradar-scan",
		ports,
		raw: result.stdout,
		...(reason ? { reason } : {}),
		scanner,
		scanSpeed,
		skipScan,
		status: streams.length > 0 ? "streams-found" : "completed",
		stderr: result.stderr,
		streamCount: streams.length,
		streams,
		targets,
		processTimeout,
		timeout,
		ui,
		...(attackInterval ? { attackInterval } : {}),
		...(outputPath ? { outputPath } : {}),
		...(outputContent ? { outputContent } : {}),
	};
};

const cameradarVersionResponseParser: BpkgBindingResponseParser = async (result, context) => ({
	bindingId: context.bindingId,
	bootstrapVersion: CAMERADAR_BOOTSTRAP_VERSION,
	kind: "cameradar-version",
	...parseVersionOutput([result.stdout, result.stderr].filter(Boolean).join("\n")),
	raw: result.stdout,
	stderr: result.stderr,
});

export const cameradarBindings = defineBindings({
	package: "@bpkg/cameradar",
	description: "Cameradar RTSP discovery and credential attack helpers running inside the selected bpkg box.",
	dependency: {
		pacman: ["go", "masscan", "nmap"],
	},
	id: "cameradar",
	bindings: {
		scan: {
			description: "Scan one or more targets for RTSP streams and attempt route and credential discovery with Cameradar.",
			defaultParameterName: "targets",
			parameters: {
				target: {
					type: "string",
					description: "Single target, hostname, CIDR, IP range, or targets file path inside the selected box.",
					example: "192.168.1.0/24",
				},
				targets: {
					type: "string[]",
					description: "One or more targets, hostnames, CIDRs, IP ranges, or targets file paths inside the selected box.",
					example: "192.168.1.0/24,192.168.1.25-30",
				},
				port: {
					type: "string",
					description: "Single RTSP port or service name such as 554, 8554-8555, or http.",
					example: "8554",
				},
				ports: {
					type: "string[]",
					description: "One or more RTSP ports, ranges, or service names. Defaults to 554, 5554, 8554, and http.",
					example: "554,8554,http",
				},
				customRoutes: {
					type: "string",
					description: "Optional custom routes dictionary path inside the selected box.",
					example: "/root/dictionaries/routes",
				},
				customCredentials: {
					type: "string",
					description: "Optional custom credentials JSON path inside the selected box.",
					example: "/root/dictionaries/credentials.json",
				},
				scanner: {
					type: "string",
					description: "Discovery backend: nmap or masscan. Defaults to nmap.",
					example: "nmap",
				},
				scanSpeed: {
					type: "number",
					description: "Nmap timing preset from 0 to 5. Defaults to 4.",
					example: "4",
				},
				attackInterval: {
					type: "string",
					description: "Optional delay between attack attempts, for example 500ms or 2s.",
					example: "500ms",
				},
				timeout: {
					type: "string",
					description: "Optional timeout for attack attempts. Defaults to 2s.",
					example: "2s",
				},
				processTimeout: {
					type: "string",
					description: "Optional hard timeout for each Cameradar subprocess. Defaults to 120s so stalled credential attacks do not block notebook await forever.",
					example: "120s",
				},
				skipScan: {
					type: "boolean",
					description: "Skip discovery and treat every target and port as an RTSP stream.",
					example: "true",
				},
				debug: {
					type: "boolean",
					description: "Enable Cameradar debug logs.",
					example: "true",
				},
				ui: {
					type: "string",
					description: "UI mode: auto, plain, or tui. Defaults to plain for bpkg execution.",
					example: "plain",
				},
				outputPath: {
					type: "string",
					description: "Optional M3U output path inside the selected box for discovered streams.",
					example: "/root/results/cameradar.m3u",
				},
			},
			acceptedExitCodes: [1],
			notebookTypeOverlay: CAMERADAR_SCAN_NOTEBOOK_TYPE_OVERLAY,
			prepare: cameradarScanPrepare,
			responseParser: cameradarScanResponseParser,
		},
		version: {
			description: "Print the bootstrapped Cameradar and bundled nmap version information.",
			responseParser: cameradarVersionResponseParser,
		},
	},
	transformers: {
		async scan(params) {
			return buildScanCommand(params);
		},
		async version() {
			return createBootstrappedRootCommand(["version"]);
		},
	},
});

export default cameradarBindings;