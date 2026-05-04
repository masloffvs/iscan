import { defineBindings, type BpkgTranspiledCommand } from "./define-bindings";

const METASPLOIT_WORKSPACE_PATTERN = /^[A-Za-z0-9_.-]+$/u;
const METASPLOIT_OPTION_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/u;
const SUPPORTED_MSFDB_COMPONENTS = new Set(["database", "webservice", "all"]);

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

function normalizePositiveInteger(value: unknown, label: string): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(numericValue) || numericValue <= 0) {
		throw new Error(`${label} must be a positive integer.`);
	}

	return numericValue;
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

function normalizeWorkspaceName(value: unknown): string | undefined {
	const normalized = normalizeOptionalString(value, "Metasploit workspace");
	if (!normalized) {
		return undefined;
	}

	if (!METASPLOIT_WORKSPACE_PATTERN.test(normalized)) {
		throw new Error("Metasploit workspace may only contain letters, numbers, dot, underscore, and dash.");
	}

	return normalized;
}

function normalizeCommandList(value: unknown, label: string): string[] {
	const values = Array.isArray(value)
		? value
		: value === undefined || value === null || value === ""
			? []
			: [value];

	const normalized = values
		.map((entry, index) => normalizeRequiredString(entry, `${label}[${index}]`).replace(/[;\s]+$/u, ""))
		.filter(Boolean);

	if (normalized.length === 0) {
		throw new Error(`${label} must contain at least one command.`);
	}

	return normalized;
}

function normalizeMsfdbComponent(value: unknown): string | undefined {
	const normalized = normalizeOptionalString(value, "Metasploit component");
	if (!normalized) {
		return undefined;
	}

	if (!SUPPORTED_MSFDB_COMPONENTS.has(normalized)) {
		throw new Error("Metasploit component must be one of: database, webservice, all.");
	}

	return normalized;
}

function normalizeOutputPath(value: unknown): string {
	return normalizeRequiredString(value, "Metasploit outputPath");
}

function normalizeDestructiveConfirmation(value: unknown, label: string): true {
	if (value !== true) {
		throw new Error(`${label} requires confirm=true.`);
	}

	return true;
}

function normalizePayloadOptions(value: unknown): string[] {
	if (value === undefined || value === null || value === "") {
		return [];
	}

	if (!isRecord(value)) {
		throw new Error("Metasploit payloadOptions must be an object.");
	}

	return Object.entries(value).map(([key, entryValue]) => {
		if (!METASPLOIT_OPTION_KEY_PATTERN.test(key)) {
			throw new Error(`Metasploit payload option '${key}' has an invalid name.`);
		}

		if (typeof entryValue === "string") {
			return `${key}=${normalizeRequiredString(entryValue, `Metasploit payload option ${key}`)}`;
		}

		if (typeof entryValue === "number") {
			if (!Number.isFinite(entryValue)) {
				throw new Error(`Metasploit payload option '${key}' must be finite.`);
			}
			return `${key}=${entryValue}`;
		}

		if (typeof entryValue === "boolean") {
			return `${key}=${entryValue ? "true" : "false"}`;
		}

		throw new Error(`Metasploit payload option '${key}' must be a string, number, or boolean.`);
	});
}

function createRootCommand(argv: readonly string[]): BpkgTranspiledCommand {
	return {
		argv: [...argv],
		createdAt: Date.now(),
		cwd: "/root",
	};
}

function buildMsfconsoleScript(
	commands: readonly string[],
	options: {
		exitOnComplete?: boolean;
		workspace?: string;
	} = {},
): string {
	const scriptCommands: string[] = [];
	if (options.workspace) {
		scriptCommands.push(`workspace ${options.workspace}`);
	}

	for (const command of commands) {
		const normalized = normalizeRequiredString(command, "Metasploit console command").replace(/[;\s]+$/u, "");
		if (normalized.length > 0) {
			scriptCommands.push(normalized);
		}
	}

	if (options.exitOnComplete) {
		scriptCommands.push("exit -y");
	}

	return scriptCommands.join("; ");
}

function createMsfdbCommand(
	action: "status" | "start" | "stop" | "restart" | "init" | "reinit" | "delete",
	params: {
		component?: unknown;
		connectionString?: unknown;
		dbPort?: unknown;
		msfDbName?: unknown;
		msfDbUserName?: unknown;
		useDefaults?: unknown;
	},
): BpkgTranspiledCommand {
	const component = normalizeMsfdbComponent(params.component);
	const connectionString = normalizeOptionalString(params.connectionString, "Metasploit connectionString");
	const dbPort = normalizePositiveInteger(params.dbPort, "Metasploit dbPort");
	const msfDbName = normalizeOptionalString(params.msfDbName, "Metasploit msfDbName");
	const msfDbUserName = normalizeOptionalString(params.msfDbUserName, "Metasploit msfDbUserName");
	const useDefaults = normalizeBoolean(params.useDefaults, "Metasploit useDefaults");

	const argv = ["msfdb"];
	if (component) {
		argv.push("--component", component);
	}
	if (useDefaults) {
		argv.push("--use-defaults");
	}
	if (connectionString) {
		argv.push("--connection-string", connectionString);
	}
	if (dbPort !== undefined) {
		argv.push("--db-port", String(dbPort));
	}
	if (msfDbName) {
		argv.push("--msf-db-name", msfDbName);
	}
	if (msfDbUserName) {
		argv.push("--msf-db-user-name", msfDbUserName);
	}

	argv.push(action);
	return createRootCommand(argv);
}

const workspaceParameter = {
	type: "string",
	description: "Optional Metasploit workspace name.",
	example: "default",
} as const;

const msfdbComponentParameter = {
	type: "string",
	description: "Optional Metasploit component: database, webservice, or all.",
	example: "database",
} as const;

const confirmParameter = {
	type: "boolean",
	description: "Must be true to confirm a destructive Metasploit database action.",
	example: "true",
	required: true,
} as const;

const useDefaultsParameter = {
	type: "boolean",
	description: "Use Metasploit defaults to avoid interactive prompts.",
	example: "true",
} as const;

export const metasploitBindings = defineBindings({
	package: "@bpkg/metasploit",
	description: "Metasploit Framework - a powerful and versatile penetration testing platform.",
	dependency: {
		pacman: ["metasploit"],
	},
	id: "metasploit",
	bindings: {
		msfconsole: {
			description: "Launch an interactive msfconsole session.",
			defaultParameterName: "workspace",
			parameters: {
				workspace: workspaceParameter,
			},
		},
		msfconsoleBatch: {
			description: "Run one-shot msfconsole commands through -x and exit when complete.",
			defaultParameterName: "commands",
			parameters: {
				commands: {
					type: "string[]",
					description: "One or more msfconsole commands to execute sequentially.",
					example: "version,help",
					required: true,
				},
				exitOnComplete: {
					type: "boolean",
					description: "Append 'exit -y' after the batch commands. Defaults to true.",
					example: "true",
				},
				workspace: workspaceParameter,
			},
		},
		msfvenom: {
			description: "Generate payloads with msfvenom and write them to a file inside the selected box.",
			defaultParameterName: "payload",
			parameters: {
				payload: {
					type: "string",
					description: "Metasploit payload identifier.",
					example: "linux/x64/meterpreter/reverse_tcp",
					required: true,
				},
				format: {
					type: "string",
					description: "msfvenom output format.",
					example: "elf",
					required: true,
				},
				outputPath: {
					type: "string",
					description: "Required output path inside the selected box.",
					example: "/root/payload.elf",
					required: true,
				},
				arch: {
					type: "string",
					description: "Optional architecture override.",
					example: "x64",
				},
				badChars: {
					type: "string",
					description: "Characters to avoid, for example \\x00\\x0a.",
					example: "\\x00\\x0a",
				},
				encoder: {
					type: "string",
					description: "Optional encoder name.",
					example: "x64/xor",
				},
				iterations: {
					type: "number",
					description: "Optional encoder iteration count.",
					example: "2",
				},
				lhost: {
					type: "string",
					description: "Optional LHOST payload option.",
					example: "192.168.1.10",
				},
				lport: {
					type: "number",
					description: "Optional LPORT payload option.",
					example: "4444",
				},
				payloadOptions: {
					type: "json",
					description: "Optional JSON object of additional payload KEY=VALUE options.",
					example: '{"EXITFUNC":"thread"}',
				},
				platform: {
					type: "string",
					description: "Optional target platform.",
					example: "linux",
				},
			},
		},
		msfdbStatus: {
			description: "Check Metasploit database or webservice status.",
			parameters: {
				component: msfdbComponentParameter,
			},
		},
		msfdbStart: {
			description: "Start the Metasploit database or webservice component.",
			parameters: {
				component: msfdbComponentParameter,
			},
		},
		msfdbStop: {
			description: "Stop the Metasploit database or webservice component.",
			parameters: {
				component: msfdbComponentParameter,
			},
		},
		msfdbRestart: {
			description: "Restart the Metasploit database or webservice component.",
			parameters: {
				component: msfdbComponentParameter,
			},
		},
		msfdbInit: {
			description: "Initialize the Metasploit database or webservice with non-interactive defaults.",
			parameters: {
				component: msfdbComponentParameter,
				connectionString: {
					type: "string",
					description: "Optional existing PostgreSQL connection string.",
					example: "postgresql://postgres:secret@localhost:5432/postgres",
				},
				dbPort: {
					type: "number",
					description: "Optional Metasploit database port override.",
					example: "5433",
				},
				msfDbName: {
					type: "string",
					description: "Optional Metasploit database name.",
					example: "msf",
				},
				msfDbUserName: {
					type: "string",
					description: "Optional Metasploit database username.",
					example: "msf",
				},
				useDefaults: useDefaultsParameter,
			},
		},
		msfdbReinit: {
			description: "Delete and reinitialize the Metasploit database or webservice component.",
			parameters: {
				component: msfdbComponentParameter,
				confirm: confirmParameter,
				connectionString: {
					type: "string",
					description: "Optional existing PostgreSQL connection string.",
					example: "postgresql://postgres:secret@localhost:5432/postgres",
				},
				dbPort: {
					type: "number",
					description: "Optional Metasploit database port override.",
					example: "5433",
				},
				msfDbName: {
					type: "string",
					description: "Optional Metasploit database name.",
					example: "msf",
				},
				msfDbUserName: {
					type: "string",
					description: "Optional Metasploit database username.",
					example: "msf",
				},
				useDefaults: useDefaultsParameter,
			},
		},
		msfdbDelete: {
			description: "Delete and stop the Metasploit database or webservice component.",
			parameters: {
				component: msfdbComponentParameter,
				confirm: confirmParameter,
			},
		},
	},
	transformers: {
		async msfconsole(params) {
			const workspace = normalizeWorkspaceName(params.workspace);
			return workspace
				? createRootCommand(["msfconsole", "-q", "-x", buildMsfconsoleScript([], { workspace })])
				: createRootCommand(["msfconsole", "-q"]);
		},
		async msfconsoleBatch(params) {
			const workspace = normalizeWorkspaceName(params.workspace);
			const commands = normalizeCommandList(params.commands, "Metasploit commands");
			const exitOnComplete = normalizeBoolean(params.exitOnComplete, "Metasploit exitOnComplete") ?? true;

			return createRootCommand([
				"msfconsole",
				"-q",
				"-x",
				buildMsfconsoleScript(commands, {
					exitOnComplete,
					workspace,
				}),
			]);
		},
		async msfvenom(params) {
			const payload = normalizeRequiredString(params.payload, "Metasploit payload");
			const format = normalizeRequiredString(params.format, "Metasploit format");
			const outputPath = normalizeOutputPath(params.outputPath);
			const arch = normalizeOptionalString(params.arch, "Metasploit arch");
			const badChars = normalizeOptionalString(params.badChars, "Metasploit badChars");
			const encoder = normalizeOptionalString(params.encoder, "Metasploit encoder");
			const iterations = normalizePositiveInteger(params.iterations, "Metasploit iterations");
			const lhost = normalizeOptionalString(params.lhost, "Metasploit lhost");
			const lport = normalizePositiveInteger(params.lport, "Metasploit lport");
			const platform = normalizeOptionalString(params.platform, "Metasploit platform");
			const payloadOptions = normalizePayloadOptions(params.payloadOptions);

			const argv = ["msfvenom", "-p", payload, ...payloadOptions];
			if (lhost) {
				argv.push(`LHOST=${lhost}`);
			}
			if (lport !== undefined) {
				argv.push(`LPORT=${lport}`);
			}
			if (arch) {
				argv.push("-a", arch);
			}
			if (platform) {
				argv.push("--platform", platform);
			}
			if (encoder) {
				argv.push("-e", encoder);
			}
			if (iterations !== undefined) {
				argv.push("-i", String(iterations));
			}
			if (badChars) {
				argv.push("-b", badChars);
			}
			argv.push("-f", format, "-o", outputPath);

			return createRootCommand(argv);
		},
		async msfdbStatus(params) {
			return createMsfdbCommand("status", params);
		},
		async msfdbStart(params) {
			return createMsfdbCommand("start", params);
		},
		async msfdbStop(params) {
			return createMsfdbCommand("stop", params);
		},
		async msfdbRestart(params) {
			return createMsfdbCommand("restart", params);
		},
		async msfdbInit(params) {
			return createMsfdbCommand("init", {
				...params,
				useDefaults: params.useDefaults ?? true,
			});
		},
		async msfdbReinit(params) {
			normalizeDestructiveConfirmation(params.confirm, "Metasploit msfdbReinit");
			return createMsfdbCommand("reinit", {
				...params,
				useDefaults: params.useDefaults ?? true,
			});
		},
		async msfdbDelete(params) {
			normalizeDestructiveConfirmation(params.confirm, "Metasploit msfdbDelete");
			return createMsfdbCommand("delete", params);
		},
	},
});

export default metasploitBindings;