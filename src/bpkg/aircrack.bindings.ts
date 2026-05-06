import {
	defineBindings,
	type BpkgBindingPrepare,
	type BpkgBindingResponseParser,
	type BpkgTranspiledCommand,
} from "./define-bindings";

const AIRCRACK_BSSID_PATTERN = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$/u;
const AIRCRACK_SIMD_PATTERN = /^[A-Za-z0-9_-]+$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function normalizePositiveInteger(
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

function normalizeOptionalBssid(value: unknown): string | undefined {
	const normalized = normalizeOptionalString(value, "Aircrack bssid");
	if (!normalized) {
		return undefined;
	}

	if (!AIRCRACK_BSSID_PATTERN.test(normalized)) {
		throw new Error("Aircrack bssid must be a MAC address like 00:11:22:33:44:55.");
	}

	return normalized.toUpperCase();
}

function normalizeOptionalSimd(value: unknown): string | undefined {
	const normalized = normalizeOptionalString(value, "Aircrack simd");
	if (!normalized) {
		return undefined;
	}

	if (!AIRCRACK_SIMD_PATTERN.test(normalized)) {
		throw new Error("Aircrack simd must contain only letters, numbers, dash, or underscore.");
	}

	return normalized;
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function mergeStringInputs(
	params: Record<string, unknown>,
	options: {
		singular?: string;
		plural?: string;
		label: string;
	},
): string[] {
	const values = [
		...(options.singular ? (normalizeOptionalString(params[options.singular], options.label) ? [normalizeRequiredString(params[options.singular], options.label)] : []) : []),
		...(options.plural ? (normalizeOptionalStringArray(params[options.plural], options.label) ?? []) : []),
	];
	return uniqueStrings(values);
}

function normalizeCapturePaths(params: Record<string, unknown>): string[] {
	return mergeStringInputs(params, {
		label: "Aircrack capture",
		plural: "captures",
		singular: "capture",
	});
}

function normalizeWordlistPaths(params: Record<string, unknown>): string[] {
	return mergeStringInputs(params, {
		label: "Aircrack wordlist",
		plural: "wordlists",
		singular: "wordlist",
	});
}

function createRootCommand(argv: readonly string[]): BpkgTranspiledCommand {
	return {
		argv: [...argv],
		createdAt: Date.now(),
		cwd: "/root",
	};
}

function splitOutputLines(text: string): string[] {
	return text
		.split(/\r?\n/u)
		.map((entry) => entry.trimEnd())
		.filter((entry) => entry.trim().length > 0);
}

function parseOptionalPercent(text: string, pattern: RegExp): number | undefined {
	const match = text.match(pattern);
	if (!match?.[1]) {
		return undefined;
	}

	const numericValue = Number.parseFloat(match[1]);
	return Number.isFinite(numericValue) ? numericValue : undefined;
}

function parseAircrackProgress(text: string): {
	elapsed?: string;
	extra?: string;
	speed?: string;
	testedKeys?: number;
	totalKeys?: number;
} {
	const progressPatterns = [
		/\[(\d{2}:\d{2}:\d{2})\]\s+(\d+)(?:\/(\d+))?\s+keys tested(?:\s+\(([^)]+)\))?/u,
		/\[(\d{2}:\d{2}:\d{2})\]\s+Tested\s+(\d+)\s+keys(?:\s+\(([^)]+)\))?/u,
	];

	for (const pattern of progressPatterns) {
		const match = text.match(pattern);
		if (!match) {
			continue;
		}

		const testedKeys = Number.parseInt(match[2] ?? "", 10);
		const totalKeys = match[3] ? Number.parseInt(match[3], 10) : undefined;
		const extra = match[4]?.trim();
		const speed = extra?.includes("/s") ? extra : undefined;
		return {
			elapsed: match[1],
			...(Number.isFinite(testedKeys) ? { testedKeys } : {}),
			...(totalKeys !== undefined && Number.isFinite(totalKeys) ? { totalKeys } : {}),
			...(speed ? { speed } : {}),
			...(extra ? { extra } : {}),
		};
	}

	return {};
}

function readRecoveredKeyFromLog(content: string): string | undefined {
	const lines = splitOutputLines(content);
	if (lines.length === 0) {
		return undefined;
	}

	return lines[lines.length - 1]?.trim() || undefined;
}

function buildCrackCommand(params: Record<string, unknown>): BpkgTranspiledCommand {
	const captures = normalizeCapturePaths(params);
	const wordlists = normalizeWordlistPaths(params);
	const airolib = normalizeOptionalString(params.airolib ?? params.airolibDatabase, "Aircrack airolib");
	const bssid = normalizeOptionalBssid(params.bssid);
	const essid = normalizeOptionalString(params.essid, "Aircrack essid");
	const threads = normalizePositiveInteger(params.threads ?? params.nbcpu, "Aircrack threads", { min: 1 });
	const quiet = normalizeBoolean(params.quiet, "Aircrack quiet") ?? false;
	const simd = normalizeOptionalSimd(params.simd);
	const keyLogFile = normalizeOptionalString(params.keyLogFile ?? params.logKeyFile, "Aircrack keyLogFile");
	const newSessionFile = normalizeOptionalString(params.newSessionFile ?? params.sessionFile, "Aircrack newSessionFile");
	const restoreSessionFile = normalizeOptionalString(params.restoreSessionFile ?? params.restoreSession, "Aircrack restoreSessionFile");

	if (restoreSessionFile) {
		const disallowedInputs = [
			captures.length > 0,
			wordlists.length > 0,
			Boolean(airolib),
			Boolean(bssid),
			Boolean(essid),
			threads !== undefined,
			quiet,
			Boolean(simd),
			Boolean(keyLogFile),
			Boolean(newSessionFile),
		].some(Boolean);
		if (disallowedInputs) {
			throw new Error("restoreSessionFile must be used on its own because aircrack-ng restore mode does not accept new options.");
		}

		return createRootCommand(["aircrack-ng", "-R", restoreSessionFile]);
	}

	if (captures.length === 0) {
		throw new Error("Aircrack crack requires at least one capture file.");
	}

	if (wordlists.length === 0 && !airolib) {
		throw new Error("Aircrack crack requires either wordlist/wordlists or airolib.");
	}

	if (wordlists.length > 0 && airolib) {
		throw new Error("Aircrack crack accepts either wordlists or airolib, not both.");
	}

	if (wordlists.includes("-")) {
		throw new Error("Aircrack crack does not support stdin wordlists in bpkg bindings. Use wordlist files inside the box.");
	}

	if (newSessionFile && airolib) {
		throw new Error("Aircrack cracking sessions are only supported with wordlist files, not airolib databases.");
	}

	const argv = ["aircrack-ng"];
	if (bssid) {
		argv.push("-b", bssid);
	}
	if (essid) {
		argv.push("-e", essid);
	}
	if (threads !== undefined) {
		argv.push("-p", String(threads));
	}
	if (quiet) {
		argv.push("-q");
	}
	if (keyLogFile) {
		argv.push("-l", keyLogFile);
	}
	if (newSessionFile) {
		argv.push("-N", newSessionFile);
	}
	if (wordlists.length > 0) {
		argv.push("-w", wordlists.join(","));
	}
	if (airolib) {
		argv.push("-r", airolib);
	}
	if (simd) {
		argv.push(`--simd=${simd}`);
	}

	argv.push(...captures);
	return createRootCommand(argv);
}

const aircrackCrackPrepare: BpkgBindingPrepare = async (context) => {
	const params = isRecord(context.params) ? context.params : {};
	const restoreSessionFile = normalizeOptionalString(params.restoreSessionFile ?? params.restoreSession, "Aircrack restoreSessionFile");
	if (restoreSessionFile) {
		if (!(await context.boxFileExists(restoreSessionFile))) {
			throw new Error(`Aircrack restore session file '${restoreSessionFile}' was not found inside the selected box.`);
		}
		return;
	}

	for (const capturePath of normalizeCapturePaths(params)) {
		if (!(await context.boxFileExists(capturePath))) {
			throw new Error(`Aircrack capture file '${capturePath}' was not found inside the selected box.`);
		}
	}

	for (const wordlistPath of normalizeWordlistPaths(params)) {
		if (!(await context.boxFileExists(wordlistPath))) {
			throw new Error(`Aircrack wordlist file '${wordlistPath}' was not found inside the selected box.`);
		}
	}

	const airolib = normalizeOptionalString(params.airolib ?? params.airolibDatabase, "Aircrack airolib");
	if (airolib && !(await context.boxFileExists(airolib))) {
		throw new Error(`Aircrack airolib database '${airolib}' was not found inside the selected box.`);
	}
};

const aircrackCrackResponseParser: BpkgBindingResponseParser = async (result, context) => {
	const captures = normalizeCapturePaths(context.params);
	const wordlists = normalizeWordlistPaths(context.params);
	const airolib = normalizeOptionalString(context.params.airolib ?? context.params.airolibDatabase, "Aircrack airolib");
	const bssid = normalizeOptionalBssid(context.params.bssid);
	const essid = normalizeOptionalString(context.params.essid, "Aircrack essid");
	const keyLogFile = normalizeOptionalString(context.params.keyLogFile ?? context.params.logKeyFile, "Aircrack keyLogFile");
	const newSessionFile = normalizeOptionalString(context.params.newSessionFile ?? context.params.sessionFile, "Aircrack newSessionFile");
	const restoreSessionFile = normalizeOptionalString(context.params.restoreSessionFile ?? context.params.restoreSession, "Aircrack restoreSessionFile");
	const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
	const lines = splitOutputLines(combinedOutput);
	const keyMatch = combinedOutput.match(/KEY FOUND!\s+\[\s*([^\]]+?)\s*\]/u);
	const probability = parseOptionalPercent(combinedOutput, /Probability:\s*([0-9.]+)%/u);
	const decryptedCorrectly = parseOptionalPercent(combinedOutput, /Decrypted correctly:\s*([0-9.]+)%/u);
	const packetCountMatch = combinedOutput.match(/Read\s+(\d+)\s+packets?\./u);
	const openedFiles = lines
		.filter((line) => line.startsWith("Opening "))
		.map((line) => line.slice("Opening ".length).trim())
		.filter(Boolean);
	const noValidHandshake = /No valid WPA handshakes found/iu.test(combinedOutput);
	const passphraseNotFound = /Passphrase not in dictionary/iu.test(combinedOutput);
	const missingEssid = /An ESSID is required\. Try option -e\./u.test(combinedOutput);
	const progress = parseAircrackProgress(combinedOutput);
	let recoveredKey = keyMatch?.[1]?.trim() || undefined;
	let keyLogContent: string | undefined;

	if (keyLogFile) {
		keyLogContent = await context.readFile(keyLogFile)
			.then((content) => content.trim())
			.catch(() => undefined);
		if (!recoveredKey && keyLogContent) {
			recoveredKey = readRecoveredKeyFromLog(keyLogContent);
		}
	}

	const keyFound = Boolean(recoveredKey);
	const status = keyFound
		? "key-found"
		: passphraseNotFound
			? "key-not-found"
			: noValidHandshake
				? "no-valid-handshake"
				: missingEssid
					? "missing-essid"
					: restoreSessionFile
						? "restored-session"
						: "completed";

	return {
		bindingId: context.bindingId,
		captures,
		...(openedFiles.length > 0 ? { openedFiles } : {}),
		...(packetCountMatch?.[1] ? { packetCount: Number.parseInt(packetCountMatch[1], 10) } : {}),
		...(bssid ? { bssid } : {}),
		...(essid ? { essid } : {}),
		kind: "aircrack-crack",
		mode: restoreSessionFile
			? "restore-session"
			: airolib
				? "airolib"
				: "wordlists",
		...(wordlists.length > 0 ? { wordlists } : {}),
		...(airolib ? { airolib } : {}),
		...(newSessionFile ? { newSessionFile } : {}),
		...(restoreSessionFile ? { restoreSessionFile } : {}),
		status,
		keyFound,
		...(recoveredKey ? { recoveredKey } : {}),
		...(keyLogFile ? { keyLogFile } : {}),
		...(keyLogContent ? { keyLogContent } : {}),
		...(probability !== undefined ? { probability } : {}),
		...(decryptedCorrectly !== undefined ? { decryptedCorrectly } : {}),
		...(Object.keys(progress).length > 0 ? { progress } : {}),
		messages: {
			missingEssid,
			noValidHandshake,
			passphraseNotFound,
		},
		raw: result.stdout,
		stderr: result.stderr,
	};
};

export const aircrackBindings = defineBindings({
	package: "@bpkg/aircrack",
	description: "Aircrack-ng offline capture cracking helpers running inside the selected bpkg box.",
	dependency: {
		pacman: ["aircrack-ng"],
	},
	id: "aircrack",
	bindings: {
		crack: {
			description: "Run offline aircrack-ng cracking against one or more capture files using wordlists or an airolib-ng database.",
			defaultParameterName: "capture",
			parameters: {
				capture: {
					type: "string",
					description: "Primary capture path inside the selected box. Use captures for multiple files.",
					example: "/root/captures/wpa.cap",
				},
				captures: {
					type: "string[]",
					description: "One or more capture paths inside the selected box.",
					example: "/root/captures/wpa.cap,/root/captures/wpa2.cap",
				},
				wordlist: {
					type: "string",
					description: "Single wordlist path inside the selected box.",
					example: "/root/wordlists/password.lst",
				},
				wordlists: {
					type: "string[]",
					description: "One or more wordlist paths inside the selected box; multiple files are comma-joined for aircrack-ng -w.",
					example: "/root/wordlists/password.lst,/root/wordlists/top-1k.txt",
				},
				airolib: {
					type: "string",
					description: "Path to an airolib-ng database inside the selected box. Mutually exclusive with wordlists.",
					example: "/root/db/wpa.sqlite",
				},
				bssid: {
					type: "string",
					description: "Optional target access point MAC address.",
					example: "00:14:6C:7E:40:80",
				},
				essid: {
					type: "string",
					description: "Optional ESSID selector; required for hidden ESSIDs.",
					example: "teddy",
				},
				threads: {
					type: "number",
					description: "Optional CPU thread count passed to aircrack-ng -p.",
					example: "4",
				},
				simd: {
					type: "string",
					description: "Optional SIMD override such as avx2, avx, sse2, or generic.",
					example: "avx2",
				},
				keyLogFile: {
					type: "string",
					description: "Optional output path inside the selected box where aircrack-ng should log the recovered key.",
					example: "/root/results/found.key",
				},
				newSessionFile: {
					type: "string",
					description: "Optional cracking session file created and updated by aircrack-ng -N. Supported only with wordlist files.",
					example: "/root/sessions/wpa.session",
				},
				restoreSessionFile: {
					type: "string",
					description: "Restore a previously saved cracking session with aircrack-ng -R. Must be used on its own.",
					example: "/root/sessions/wpa.session",
				},
				quiet: {
					type: "boolean",
					description: "Enable quiet mode and suppress most status output until completion.",
					example: "true",
				},
			},
			prepare: aircrackCrackPrepare,
			responseParser: aircrackCrackResponseParser,
		},
	},
	transformers: {
		async crack(params) {
			return buildCrackCommand(params);
		},
	},
});

export default aircrackBindings;