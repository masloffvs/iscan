import { defineBindings, type BpkgBindingResponseParser, type BpkgTranspiledCommand } from "./define-bindings";

const SUPPORTED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

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

function normalizeHttpMethod(value: unknown): string | undefined {
	const normalized = normalizeOptionalString(value, "SQLmap method");
	if (!normalized) {
		return undefined;
	}

	const uppercased = normalized.toUpperCase();
	if (!SUPPORTED_HTTP_METHODS.has(uppercased)) {
		throw new Error("SQLmap method must be one of: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.");
	}

	return uppercased;
}

function createRootCommand(argv: readonly string[]): BpkgTranspiledCommand {
	return {
		argv: [...argv],
		createdAt: Date.now(),
		cwd: "/root",
	};
}

type SqlmapBaseParams = {
	cookie?: unknown;
	data?: unknown;
	flushSession?: unknown;
	level?: unknown;
	method?: unknown;
	outputDir?: unknown;
	randomAgent?: unknown;
	risk?: unknown;
	url?: unknown;
};

export type SqlmapStructuredSeverity = "critical" | "error" | "info" | "warning";

export type SqlmapInjectionPoint = {
	parameter: string;
	place?: string;
	payloads: string[];
	titles: string[];
	types: string[];
};

export type SqlmapStructuredResponse = {
	banner?: string;
	backendDbms?: string;
	bindingId: string;
	currentDatabase?: string;
	currentUser?: string;
	databases: string[];
	hostname?: string;
	injectionPoints: SqlmapInjectionPoint[];
	kind: "sqlmap-report";
	messages: Record<SqlmapStructuredSeverity, string[]>;
	operatingSystem?: string;
	outputDir?: string;
	tablesByDatabase: Record<string, string[]>;
	targetUrl: string;
	vulnerable: boolean | null;
	webApplicationTechnology?: string;
	webServerOperatingSystem?: string;
};

function trimQuotes(value: string): string {
	return value.replace(/^['"]|['"]$/gu, "").trim();
}

function pushUnique(target: string[], value: string): void {
	if (!target.includes(value)) {
		target.push(value);
	}
}

function parseSqlmapMessage(rawLine: string): { level?: SqlmapStructuredSeverity; text: string } | null {
	const trimmed = rawLine.trim();
	if (trimmed.length === 0) {
		return null;
	}

	const match = trimmed.match(/^(?:\[\d{2}:\d{2}:\d{2}\]\s*)?\[(INFO|WARNING|CRITICAL|ERROR)\]\s*(.*)$/u);
	if (!match) {
		return { text: trimmed };
	}

	return {
		level: match[1].toLowerCase() as SqlmapStructuredSeverity,
		text: match[2].trim(),
	};
}

const sqlmapResponseParser: BpkgBindingResponseParser = async (result, context) => {
	const messages: Record<SqlmapStructuredSeverity, string[]> = {
		critical: [],
		error: [],
		info: [],
		warning: [],
	};
	const injectionPoints: SqlmapInjectionPoint[] = [];
	const databases: string[] = [];
	const tablesByDatabase: Record<string, string[]> = {};
	const report: SqlmapStructuredResponse = {
		bindingId: context.bindingId,
		databases,
		injectionPoints,
		kind: "sqlmap-report",
		messages,
		...(normalizeOptionalString(context.params.outputDir, "SQLmap outputDir") ? { outputDir: normalizeOptionalString(context.params.outputDir, "SQLmap outputDir") } : {}),
		tablesByDatabase,
		targetUrl: normalizeRequiredString(context.params.url, "SQLmap url"),
		vulnerable: null,
	};

	let currentInjection: SqlmapInjectionPoint | null = null;
	let currentDatabase: string | null = null;
	let collectingDatabases = false;

	for (const rawLine of result.stdout.split(/\r?\n/u)) {
		const parsedLine = parseSqlmapMessage(rawLine);
		if (!parsedLine) {
			collectingDatabases = false;
			currentInjection = null;
			continue;
		}

		if (parsedLine.level) {
			messages[parsedLine.level].push(parsedLine.text);
		}

		const line = parsedLine.text;
		if (line.length === 0) {
			continue;
		}

		if (/identified the following injection point/iu.test(line) || /parameter .* is .*injectable/iu.test(line)) {
			report.vulnerable = true;
		}
		if (/all tested parameters do not appear to be injectable/iu.test(line) || /does not seem to be injectable/iu.test(line)) {
			report.vulnerable = false;
		}

		const parameterMatch = line.match(/^Parameter:\s+(.+?)(?:\s+\((.+)\))?$/u);
		if (parameterMatch?.[1]) {
			currentInjection = {
				parameter: parameterMatch[1].trim(),
				...(parameterMatch[2] ? { place: parameterMatch[2].trim() } : {}),
				payloads: [],
				titles: [],
				types: [],
			};
			injectionPoints.push(currentInjection);
			continue;
		}

		const typeMatch = line.match(/^Type:\s+(.+)$/u);
		if (currentInjection && typeMatch?.[1]) {
			pushUnique(currentInjection.types, typeMatch[1].trim());
			continue;
		}

		const titleMatch = line.match(/^Title:\s+(.+)$/u);
		if (currentInjection && titleMatch?.[1]) {
			pushUnique(currentInjection.titles, titleMatch[1].trim());
			continue;
		}

		const payloadMatch = line.match(/^Payload:\s+(.+)$/u);
		if (currentInjection && payloadMatch?.[1]) {
			pushUnique(currentInjection.payloads, payloadMatch[1].trim());
			continue;
		}

		const databaseSectionMatch = line.match(/^available databases \[(\d+)\]:$/iu);
		if (databaseSectionMatch) {
			collectingDatabases = true;
			currentDatabase = null;
			continue;
		}

		const databaseItemMatch = line.match(/^\[\*\]\s+(.+)$/u);
		if (collectingDatabases && databaseItemMatch?.[1]) {
			pushUnique(databases, trimQuotes(databaseItemMatch[1]));
			continue;
		}

		const currentDatabaseMatch = line.match(/^Database:\s+(.+)$/u);
		if (currentDatabaseMatch?.[1]) {
			currentDatabase = trimQuotes(currentDatabaseMatch[1]);
			tablesByDatabase[currentDatabase] ??= [];
			pushUnique(databases, currentDatabase);
			collectingDatabases = false;
			continue;
		}

		if (currentDatabase) {
			const tableBulletMatch = line.match(/^\[\*\]\s+(.+)$/u);
			if (tableBulletMatch?.[1]) {
				pushUnique(tablesByDatabase[currentDatabase], trimQuotes(tableBulletMatch[1]));
				continue;
			}

			const tableRowMatch = line.match(/^\|\s*([^|]+?)\s*\|$/u);
			if (tableRowMatch?.[1] && !/^[-+]+$/u.test(tableRowMatch[1].trim())) {
				pushUnique(tablesByDatabase[currentDatabase], trimQuotes(tableRowMatch[1]));
				continue;
			}
		}

		const keyValuePatterns: Array<[RegExp, keyof SqlmapStructuredResponse]> = [
			[/^web application technology:\s+(.+)$/iu, "webApplicationTechnology"],
			[/^web server operating system:\s+(.+)$/iu, "webServerOperatingSystem"],
			[/^(?:the )?back-end DBMS(?: is)?:\s+(.+)$/iu, "backendDbms"],
			[/^the back-end DBMS is\s+(.+)$/iu, "backendDbms"],
			[/^current user(?: is)?:\s+(.+)$/iu, "currentUser"],
			[/^current database(?: is)?:\s+(.+)$/iu, "currentDatabase"],
			[/^banner:\s+(.+)$/iu, "banner"],
			[/^hostname:\s+(.+)$/iu, "hostname"],
			[/^operating system:\s+(.+)$/iu, "operatingSystem"],
		];

		for (const [pattern, key] of keyValuePatterns) {
			const match = line.match(pattern);
			if (match?.[1]) {
				report[key] = trimQuotes(match[1]);
				break;
			}
		}
	}

	if (report.vulnerable === null && injectionPoints.length > 0) {
		report.vulnerable = true;
	}

	return report;
};

function createBaseSqlmapArgv(params: SqlmapBaseParams): string[] {
	const url = normalizeRequiredString(params.url, "SQLmap url");
	const method = normalizeHttpMethod(params.method);
	const data = normalizeOptionalString(params.data, "SQLmap data");
	const cookie = normalizeOptionalString(params.cookie, "SQLmap cookie");
	const outputDir = normalizeOptionalString(params.outputDir, "SQLmap outputDir");
	const level = normalizePositiveInteger(params.level, "SQLmap level", { min: 1, max: 5 }) ?? 1;
	const risk = normalizePositiveInteger(params.risk, "SQLmap risk", { min: 1, max: 3 }) ?? 1;
	const flushSession = normalizeBoolean(params.flushSession, "SQLmap flushSession") ?? false;
	const randomAgent = normalizeBoolean(params.randomAgent, "SQLmap randomAgent") ?? false;

	const argv = ["sqlmap", "-u", url, "--batch", "--disable-coloring", "--level", String(level), "--risk", String(risk)];
	if (method) {
		argv.push("--method", method);
	}
	if (data) {
		argv.push("--data", data);
	}
	if (cookie) {
		argv.push("--cookie", cookie);
	}
	if (outputDir) {
		argv.push("--output-dir", outputDir);
	}
	if (flushSession) {
		argv.push("--flush-session");
	}
	if (randomAgent) {
		argv.push("--random-agent");
	}

	return argv;
}

const commonSqlmapParameters = {
	url: {
		type: "string",
		description: "Target URL to test with sqlmap.",
		example: "http://127.0.0.1/item.php?id=1",
		required: true,
	},
	method: {
		type: "string",
		description: "Optional HTTP method for the request.",
		example: "POST",
	},
	data: {
		type: "string",
		description: "Optional request body for POST/PUT-style requests.",
		example: "id=1&name=test",
	},
	cookie: {
		type: "string",
		description: "Optional Cookie header content.",
		example: "PHPSESSID=abc123",
	},
	level: {
		type: "number",
		description: "Detection level from 1 to 5. Defaults to 1.",
		example: "1",
	},
	risk: {
		type: "number",
		description: "Risk level from 1 to 3. Defaults to 1.",
		example: "1",
	},
	outputDir: {
		type: "string",
		description: "Optional output directory inside the selected bpkg box.",
		example: "/root/sqlmap-output",
	},
	flushSession: {
		type: "boolean",
		description: "Discard existing sqlmap session state before running.",
		example: "true",
	},
	randomAgent: {
		type: "boolean",
		description: "Use a random HTTP User-Agent string.",
		example: "true",
	},
} as const;

export const sqlmapBindings = defineBindings({
	package: "@bpkg/sqlmap",
	description: "SQLmap - safe, non-interactive SQL injection detection and metadata enumeration inside bpkg boxes.",
	dependency: {
		pacman: ["sqlmap"],
	},
	id: "sqlmap",
	bindings: {
		detect: {
			description: "Run a safe, batch-mode sqlmap detection pass against a target URL.",
			defaultParameterName: "url",
			parameters: commonSqlmapParameters,
			responseParser: sqlmapResponseParser,
		},
		fingerprint: {
			description: "Run sqlmap in batch mode and fingerprint the backend DBMS safely.",
			defaultParameterName: "url",
			parameters: commonSqlmapParameters,
			responseParser: sqlmapResponseParser,
		},
		enumerateMetadata: {
			description: "Enumerate database names or table metadata in batch mode without dumping data.",
			defaultParameterName: "url",
			parameters: {
				...commonSqlmapParameters,
				database: {
					type: "string",
					description: "Optional database name. When provided, enumerate tables inside that database; otherwise enumerate database names.",
					example: "appdb",
				},
			},
			responseParser: sqlmapResponseParser,
		},
	},
	transformers: {
		async detect(params) {
			const argv = createBaseSqlmapArgv(params);
			argv.push("--smart", "--threads", "1");
			return createRootCommand(argv);
		},
		async fingerprint(params) {
			const argv = createBaseSqlmapArgv(params);
			argv.push("-f", "--banner", "--current-user", "--current-db", "--threads", "1");
			return createRootCommand(argv);
		},
		async enumerateMetadata(params) {
			const argv = createBaseSqlmapArgv(params);
			const database = normalizeOptionalString(params.database, "SQLmap database");
			if (database) {
				argv.push("--tables", "-D", database);
			} else {
				argv.push("--dbs");
			}
			argv.push("--threads", "1");
			return createRootCommand(argv);
		},
	},
});

export default sqlmapBindings;