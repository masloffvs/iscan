import {
	FTP_KIT_ID,
	FtpKit,
	type FtpChmodOptions,
	type FtpConnectionOptions,
	type FtpDownloadOptions,
	type FtpMkdirOptions,
	type FtpOperationHooks,
	type FtpProtocol,
	type FtpUploadOptions,
} from "../kits";
import { InvalidParamsError } from "./errors";
import { defineExecutor, defineModule, type ModuleExecutionContext } from "./module";

type EnsureFtpKitContext = Pick<ModuleExecutionContext<unknown, object>, "getKit" | "runtime">;

export type FtpDslParams = Record<string, unknown>;

type FtpDslTerminalAction = "chmod" | "download" | "mkdir" | "upload";

type NormalizedFtpDslParams = {
	config: Record<string, unknown>;
	hooks: FtpOperationHooks;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function ensureFtpKit(
	context: EnsureFtpKitContext,
	reason = "module:pkg/ftp",
): Promise<FtpKit> {
	const existingKit = context.getKit<FtpKit>(FTP_KIT_ID);
	if (existingKit) {
		return existingKit;
	}

	return await context.runtime.attachKit(new FtpKit(), { reason });
}

function parseRequiredString(value: unknown, fieldName: string): string {
	if (typeof value !== "string") {
		throw new InvalidParamsError(`${fieldName} must be a string.`);
	}

	const normalizedValue = value.trim();
	if (normalizedValue.length === 0) {
		throw new InvalidParamsError(`${fieldName} must be a non-empty string.`);
	}

	return normalizedValue;
}

function parseOptionalString(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	return parseRequiredString(value, fieldName);
}

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

function parseOptionalFunction<TCallback extends (...args: any[]) => unknown>(
	value: unknown,
	fieldName: string,
): TCallback | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (typeof value !== "function") {
		throw new InvalidParamsError(`${fieldName} must be a function.`);
	}

	return value as TCallback;
}

function parseBooleanFlag(record: Record<string, unknown>, key: string): boolean {
	return record[key] === true;
}

function parseMode(value: unknown, fieldName: string): number {
	if (typeof value === "number") {
		if (!Number.isInteger(value) || value < 0) {
			throw new InvalidParamsError(`${fieldName} must be a positive integer or an octal string like 755.`);
		}

		return value;
	}

	const rawValue = parseRequiredString(value, fieldName).replace(/^0o/iu, "");
	if (!/^[0-7]{3,4}$/u.test(rawValue)) {
		throw new InvalidParamsError(`${fieldName} must be an octal string like 755 or 0644.`);
	}

	return Number.parseInt(rawValue, 8);
}

function readFtpTerminalActions(config: Record<string, unknown>): FtpDslTerminalAction[] {
	return ["upload", "download", "mkdir", "chmod"]
		.filter((action): action is FtpDslTerminalAction => parseBooleanFlag(config, action));
}

function normalizeFtpDslParams(params: unknown): NormalizedFtpDslParams {
	if (!isRecord(params)) {
		throw new InvalidParamsError("pkg/ftp expects object-style params or the JS chain form $.pkg.ftp....");
	}

	const config: Record<string, unknown> = {};
	const transferHooks: Array<(event: Parameters<NonNullable<FtpOperationHooks["onTransfer"]>>[0]) => unknown> = [];
	const errorHooks: Array<(event: Parameters<NonNullable<FtpOperationHooks["onError"]>>[0]) => unknown> = [];
	let updateHook: ((event: Parameters<NonNullable<FtpOperationHooks["onUpdate"]>>[0]) => unknown) | undefined;
	let pendingEventName: string | null = null;

	const args = Array.isArray(params.args) ? params.args : [];
	for (const arg of args) {
		if (isRecord(arg)) {
			Object.assign(config, arg);
			continue;
		}

		if (typeof arg === "string" && parseBooleanFlag(params, "on") && pendingEventName === null) {
			pendingEventName = arg.trim().toLowerCase();
			continue;
		}

		if (typeof arg === "function") {
			if (pendingEventName === "transfer") {
				transferHooks.push(arg as (event: Parameters<NonNullable<FtpOperationHooks["onTransfer"]>>[0]) => unknown);
				pendingEventName = null;
				continue;
			}

			if (pendingEventName === "error") {
				errorHooks.push(arg as (event: Parameters<NonNullable<FtpOperationHooks["onError"]>>[0]) => unknown);
				pendingEventName = null;
				continue;
			}

			if (pendingEventName) {
				throw new InvalidParamsError("$.pkg.ftp.on(...) supports only 'transfer' and 'error' hooks.");
			}

			if (!updateHook) {
				updateHook = arg as (event: Parameters<NonNullable<FtpOperationHooks["onUpdate"]>>[0]) => unknown;
				continue;
			}

			throw new InvalidParamsError("Only one $.pkg.ftp.onUpdate(callback) handler is supported per chain.");
		}
	}

	if (pendingEventName) {
		throw new InvalidParamsError("$.pkg.ftp.on(...) requires a callback after the event name.");
	}

	for (const [key, value] of Object.entries(params)) {
		if (key === "args") {
			continue;
		}

		config[key] = value;
	}

	const inlineUpdateHook = parseOptionalFunction<(event: Parameters<NonNullable<FtpOperationHooks["onUpdate"]>>[0]) => unknown>(
		config.onUpdateCallback,
		"onUpdateCallback",
	);
	if (!updateHook && inlineUpdateHook) {
		updateHook = inlineUpdateHook;
	}

	return {
		config,
		hooks: {
			onError: errorHooks.length > 0
				? async (event) => {
					for (const hook of errorHooks) {
						await hook(event);
					}
				}
				: undefined,
			onTransfer: transferHooks.length > 0
				? async (event) => {
					for (const hook of transferHooks) {
						await hook(event);
					}
				}
				: undefined,
			onUpdate: updateHook
				? async (event) => {
					await updateHook?.(event);
				}
				: undefined,
		},
	};
}

function parseConnectionProtocol(config: Record<string, unknown>): FtpProtocol {
	const rawProtocol = parseOptionalString(config.protocol, "connect.protocol")?.toLowerCase();
	const secureValue = config.secure;
	if (!rawProtocol) {
		return secureValue === true || secureValue === "implicit" ? "ftps" : "ftp";
	}

	if (rawProtocol === "ftp" || rawProtocol === "ftps" || rawProtocol === "sftp") {
		return rawProtocol;
	}

	throw new InvalidParamsError("connect.protocol must be one of ftp, ftps, or sftp.");
}

function parseConnectionConfig(config: Record<string, unknown>): FtpConnectionOptions {
	const protocol = parseConnectionProtocol(config);
	const rawSecure = config.secure;
	let secure: boolean | "implicit" | undefined;
	if (rawSecure !== undefined && rawSecure !== null && rawSecure !== "") {
		if (rawSecure === true || rawSecure === false || rawSecure === "implicit") {
			secure = rawSecure;
		} else {
			throw new InvalidParamsError("connect.secure must be true, false, or 'implicit'.");
		}
	}

	const cwd = parseOptionalString(
		config.cwd ?? (parseBooleanFlag(config, "cd") ? config.path : undefined),
		"cd.cwd",
	);
	const password = parseOptionalString(config.pass ?? config.password, "connect.pass");
	const passphrase = parseOptionalString(config.passphrase, "connect.passphrase");
	const port = parseOptionalNumber(config.port, "connect.port");
	const privateKey = parseOptionalString(config.privateKey, "connect.privateKey");
	const timeoutMs = parseOptionalNumber(config.timeout, "connect.timeout");

	const connection: FtpConnectionOptions = {
		...(cwd ? { cwd } : {}),
		host: parseRequiredString(config.host, "connect.host"),
		...(passphrase ? { passphrase } : {}),
		...(password ? { password } : {}),
		...(port !== undefined ? { port } : {}),
		...(privateKey ? { privateKey } : {}),
		protocol,
		...(protocol === "ftps" ? { secure: secure ?? true } : {}),
		...(timeoutMs !== undefined ? { timeoutMs } : {}),
		username: parseRequiredString(config.user ?? config.username, "connect.user"),
	};

	if (protocol === "sftp" && !connection.password && !connection.privateKey) {
		throw new InvalidParamsError("SFTP requires either connect.pass or connect.privateKey.");
	}

	return connection;
}

function readWarnings(config: Record<string, unknown>, keyPrefix: string): string[] {
	const warnings: string[] = [];
	const parallel = parseOptionalNumber(config.parallel, `${keyPrefix}.parallel`);
	if (parallel !== undefined && parallel > 1) {
		warnings.push(`parallel=${parallel} requested, but transfers are currently executed sequentially.`);
	}
	return warnings;
}

function parseUploadOptions(config: Record<string, unknown>): FtpUploadOptions {
	const filter = parseOptionalFunction<FtpUploadOptions["filter"]>(config.filter, "upload.filter");
	const remotePath = parseOptionalString(config.remote, "upload.remote");
	return {
		...(filter ? { filter } : {}),
		localPath: parseRequiredString(config.local, "upload.local"),
		...(remotePath ? { remotePath } : {}),
		warnings: readWarnings(config, "upload"),
	};
}

function parseDownloadOptions(config: Record<string, unknown>): FtpDownloadOptions {
	const localPath = parseOptionalString(config.local, "download.local");
	const unzip = parseOptionalBoolean(config.unzip, "download.unzip");
	return {
		...(localPath ? { localPath } : {}),
		remotePath: parseRequiredString(config.remote, "download.remote"),
		...(unzip !== undefined ? { unzip } : {}),
		warnings: readWarnings(config, "download"),
	};
}

function parseMkdirOptions(config: Record<string, unknown>): FtpMkdirOptions {
	const remotePath = parseOptionalString(config.remoteDir ?? config.dir ?? config.path ?? config.remote, "mkdir.remoteDir");
	if (!remotePath) {
		throw new InvalidParamsError("mkdir requires remoteDir, dir, path, or remote.");
	}

	const recursive = parseOptionalBoolean(config.recursive, "mkdir.recursive");
	return {
		...(recursive !== undefined ? { recursive } : {}),
		remotePath,
		warnings: [],
	};
}

function parseChmodOptions(config: Record<string, unknown>): FtpChmodOptions {
	return {
		mode: parseMode(config.mode, "chmod.mode"),
		targetPath: parseRequiredString(config.target ?? config.remote ?? config.path, "chmod.target"),
		warnings: [],
	};
}

function pickTerminalAction(config: Record<string, unknown>): FtpDslTerminalAction {
	const actions = readFtpTerminalActions(config);
	if (actions.length === 0) {
		throw new InvalidParamsError("Incomplete $.pkg.ftp chain. Finish with .upload, .download, .mkdir, or .chmod.");
	}
	if (actions.length > 1) {
		const nonMkdirActions = actions.filter((action) => action !== "mkdir");
		if (nonMkdirActions.length === 1) {
			return nonMkdirActions[0] ?? "mkdir";
		}

		throw new InvalidParamsError("Use only one terminal ftp action per chain: upload, download, mkdir, or chmod.");
	}

	return actions[0] ?? "upload";
}

export const ftpDslModule = defineModule<FtpDslParams, unknown>({
	id: "pkg/ftp",
	category: "pkg",
	description: "Host-side FTP, FTPS, and SFTP DSL root for $.pkg.ftp.connect/cd/upload/download/mkdir/chmod.",
	consoleParams: [
		{ name: "connect", detail: "Activate the connection config block.", jsDescriptorName: "connect", valueType: "boolean" },
		{ name: "cd", detail: "Activate the remote working directory config block.", jsDescriptorName: "cd", valueType: "boolean" },
		{ name: "upload", detail: "Upload a file or directory from the host to the remote server.", jsDescriptorName: "upload", valueType: "boolean" },
		{ name: "download", detail: "Download a file or directory from the remote server to the host.", jsDescriptorName: "download", valueType: "boolean" },
		{ name: "mkdir", detail: "Create a remote directory, or pre-create one before upload/download.", jsDescriptorName: "mkdir", valueType: "boolean" },
		{ name: "chmod", detail: "Change remote permissions for a file or directory.", jsDescriptorName: "chmod", valueType: "boolean" },
		{ name: "onUpdate", detail: "Attach a progress callback for transfer and extraction events.", jsDescriptorName: "onUpdate", valueType: "boolean" },
		{ name: "on", detail: "Attach event callbacks like .on('transfer', handler) or .on('error', handler).", jsDescriptorName: "on", valueType: "boolean" },
		{ name: "host", detail: "Remote server hostname.", example: "backup.server.de", valueType: "string" },
		{ name: "protocol", detail: "Transfer protocol.", example: "ftps", values: ["ftp", "ftps", "sftp"], valueType: "string" },
		{ name: "secure", detail: "FTPS security mode; true for explicit FTPS or 'implicit' for implicit FTPS.", example: "implicit", valueType: "string" },
		{ name: "port", detail: "Remote server port.", example: "21", valueType: "number" },
		{ name: "user", detail: "Remote username.", example: "john_admin", valueType: "string" },
		{ name: "pass", detail: "Remote password.", example: "secret", valueType: "string" },
		{ name: "privateKey", detail: "Private key string for SFTP authentication.", valueType: "string" },
		{ name: "timeout", detail: "Connection timeout in milliseconds.", example: "5000", valueType: "number" },
		{ name: "cwd", detail: "Remote working directory used as the base path for relative remote targets.", example: "/var/www/media", valueType: "string" },
		{ name: "local", detail: "Local file or directory path on the host.", example: "./local_build", valueType: "string" },
		{ name: "remote", detail: "Remote file or directory path.", example: "./remote_deploy", valueType: "string" },
		{ name: "remoteDir", detail: "Explicit remote directory for mkdir or pre-create flows.", example: "./remote_deploy", valueType: "string" },
		{ name: "target", detail: "Explicit remote chmod target.", example: "./remote_deploy/index.php", valueType: "string" },
		{ name: "mode", detail: "Remote chmod mode as an octal string or number.", example: "755", valueType: "string" },
		{ name: "unzip", detail: "Extract downloaded .gz, .tgz, or .tar.gz archives after transfer.", example: "true", valueType: "boolean" },
		{ name: "parallel", detail: "Reserved concurrency hint for future transfer parallelism. Current implementation remains sequential.", example: "5", valueType: "number" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureFtpKit(context, "module:pkg/ftp");
		const { config, hooks } = normalizeFtpDslParams(context.params);
		const connection = parseConnectionConfig(config);
		const finalAction = pickTerminalAction(config);

		if (parseBooleanFlag(config, "mkdir") && finalAction !== "mkdir") {
			await kit.mkdir(connection, parseMkdirOptions(config), hooks);
		}

		if (finalAction === "upload") {
			return await kit.upload(connection, parseUploadOptions(config), hooks);
		}

		if (finalAction === "download") {
			return await kit.download(connection, parseDownloadOptions(config), hooks);
		}

		if (finalAction === "chmod") {
			return await kit.chmod(connection, parseChmodOptions(config), hooks);
		}

		return await kit.mkdir(connection, parseMkdirOptions(config), hooks);
	}),
});