import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { Client as BasicFtpClient } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";
import * as tar from "tar";

import { Kit } from "./kit";

export const FTP_KIT_ID = "ftp";

export type FtpProtocol = "ftp" | "ftps" | "sftp";

export type FtpConnectionOptions = {
	cwd?: string;
	host: string;
	passphrase?: string;
	password?: string;
	port?: number;
	privateKey?: string;
	protocol: FtpProtocol;
	secure?: boolean | "implicit";
	timeoutMs?: number;
	username: string;
};

export type FtpTransferFilterEntry = {
	absolutePath: string;
	isDirectory: boolean;
	name: string;
	relativePath: string;
	remotePath: string;
	sizeBytes?: number;
};

export type FtpTransferEvent = {
	bytesTotal?: number;
	bytesTransferred?: number;
	chunkBytes?: number;
	kind: "transfer";
	localPath?: string;
	operation: "download" | "upload";
	percent?: number;
	protocol: FtpProtocol;
	remotePath: string;
	stage: "complete" | "progress" | "start";
};

export type FtpExtractionEvent = {
	archivePath: string;
	archiveType: "gz" | "tar.gz";
	kind: "extract";
	outputPath: string;
	protocol: FtpProtocol;
};

export type FtpErrorEvent = {
	error: string;
	kind: "error";
	operation: "chmod" | "download" | "mkdir" | "upload";
	protocol: FtpProtocol;
};

export type FtpLogEvent = {
	kind: "log";
	message: string;
	protocol: FtpProtocol;
};

export type FtpUpdateEvent = FtpTransferEvent | FtpExtractionEvent | FtpErrorEvent | FtpLogEvent;

export type FtpOperationHooks = {
	onError?: (event: FtpErrorEvent) => void | Promise<void>;
	onTransfer?: (event: FtpTransferEvent | FtpExtractionEvent) => void | Promise<void>;
	onUpdate?: (event: FtpUpdateEvent) => void | Promise<void>;
};

export type FtpUploadOptions = {
	filter?: (entry: FtpTransferFilterEntry) => boolean;
	localPath: string;
	remotePath?: string;
	warnings?: string[];
};

export type FtpDownloadOptions = {
	localPath?: string;
	remotePath: string;
	unzip?: boolean;
	warnings?: string[];
};

export type FtpMkdirOptions = {
	recursive?: boolean;
	remotePath: string;
	warnings?: string[];
};

export type FtpChmodOptions = {
	mode: number;
	targetPath: string;
	warnings?: string[];
};

export type FtpTransferRecord = {
	extractedTo?: string;
	localPath?: string;
	remotePath: string;
	sizeBytes?: number;
};

export type FtpUploadResult = {
	cwd?: string;
	fileCount: number;
	files: FtpTransferRecord[];
	kind: "ftp-upload";
	protocol: FtpProtocol;
	totalBytes: number;
	warnings?: string[];
};

export type FtpDownloadResult = {
	cwd?: string;
	fileCount: number;
	files: FtpTransferRecord[];
	kind: "ftp-download";
	protocol: FtpProtocol;
	totalBytes: number;
	warnings?: string[];
};

export type FtpMkdirResult = {
	cwd?: string;
	kind: "ftp-mkdir";
	path: string;
	protocol: FtpProtocol;
	recursive: boolean;
	warnings?: string[];
};

export type FtpChmodResult = {
	cwd?: string;
	kind: "ftp-chmod";
	mode: string;
	path: string;
	protocol: FtpProtocol;
	warnings?: string[];
};

type RemoteStat = {
	exists: boolean;
	isDirectory: boolean;
	sizeBytes?: number;
};

type RemoteEntry = {
	isDirectory: boolean;
	name: string;
	path: string;
	sizeBytes?: number;
};

type LocalTree = {
	directories: string[];
	files: FtpTransferFilterEntry[];
	rootIsDirectory: boolean;
};

type RemoteTree = {
	directories: string[];
	files: RemoteEntry[];
	rootIsDirectory: boolean;
};

type FtpDriver = {
	chmod(remotePath: string, mode: number): Promise<void>;
	disconnect(): Promise<void>;
	downloadFile(remotePath: string, localPath: string, hooks: FtpOperationHooks): Promise<number | undefined>;
	ensureDir(remotePath: string): Promise<void>;
	list(remotePath: string): Promise<RemoteEntry[]>;
	stat(remotePath: string): Promise<RemoteStat>;
	uploadFile(localPath: string, remotePath: string, hooks: FtpOperationHooks): Promise<number | undefined>;
};

function normalizeRemoteSegment(value: string): string {
	return value.replace(/\\/gu, "/").trim();
}

function resolveRemotePath(basePath: string | undefined, targetPath: string): string {
	const normalizedTarget = normalizeRemoteSegment(targetPath);
	if (normalizedTarget.length === 0 || normalizedTarget === ".") {
		return basePath ? normalizeRemoteSegment(basePath) : ".";
	}

	if (normalizedTarget.startsWith("/")) {
		return path.posix.normalize(normalizedTarget);
	}

	const normalizedBase = basePath ? normalizeRemoteSegment(basePath) : "";
	if (normalizedBase.length === 0 || normalizedBase === ".") {
		return path.posix.normalize(normalizedTarget);
	}

	return path.posix.normalize(path.posix.join(normalizedBase, normalizedTarget));
}

function buildPercent(bytesTransferred: number | undefined, bytesTotal: number | undefined): number | undefined {
	if (!bytesTransferred || !bytesTotal || bytesTotal <= 0) {
		return undefined;
	}

	return Math.max(0, Math.min(100, Number(((bytesTransferred / bytesTotal) * 100).toFixed(2))));
}

function uniqueStrings(values: readonly string[]): string[] {
	return values.filter((value, index) => values.indexOf(value) === index);
}

async function emitUpdate(hooks: FtpOperationHooks, event: FtpUpdateEvent): Promise<void> {
	await hooks.onUpdate?.(event);
	if (event.kind === "transfer" || event.kind === "extract") {
		await hooks.onTransfer?.(event);
	}
	if (event.kind === "error") {
		await hooks.onError?.(event);
	}
}

function emitUpdateDetached(hooks: FtpOperationHooks, event: FtpUpdateEvent): void {
	void emitUpdate(hooks, event).catch(() => undefined);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function gunzipToFile(sourcePath: string, destinationPath: string): Promise<void> {
	await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });
	await pipeline(
		fs.createReadStream(sourcePath),
		createGunzip(),
		fs.createWriteStream(destinationPath),
	);
}

class BasicFtpDriver implements FtpDriver {
	private readonly client: BasicFtpClient;

	constructor(private readonly connection: FtpConnectionOptions) {
		this.client = new BasicFtpClient(connection.timeoutMs);
	}

	async connect(): Promise<void> {
		await this.client.access({
			host: this.connection.host,
			password: this.connection.password,
			port: this.connection.port,
			secure: this.connection.protocol === "ftps" ? (this.connection.secure ?? true) : false,
			user: this.connection.username,
		});
	}

	async disconnect(): Promise<void> {
		this.client.close();
	}

	async ensureDir(remotePath: string): Promise<void> {
		await this.client.ensureDir(remotePath);
	}

	async chmod(remotePath: string, mode: number): Promise<void> {
		await this.client.send(`SITE CHMOD ${mode.toString(8)} ${remotePath}`);
	}

	async stat(remotePath: string): Promise<RemoteStat> {
		try {
			const sizeBytes = await this.client.size(remotePath);
			return {
				exists: true,
				isDirectory: false,
				sizeBytes,
			};
		} catch {
			try {
				await this.client.list(remotePath);
				return {
					exists: true,
					isDirectory: true,
				};
			} catch {
				return {
					exists: false,
					isDirectory: false,
				};
			}
		}
	}

	async list(remotePath: string): Promise<RemoteEntry[]> {
		const entries = await this.client.list(remotePath);
		return entries
			.filter((entry) => entry.name !== "." && entry.name !== "..")
			.map((entry) => ({
				isDirectory: entry.isDirectory,
				name: entry.name,
				path: resolveRemotePath(remotePath, entry.name),
				...(typeof entry.size === "number" ? { sizeBytes: entry.size } : {}),
			}));
	}

	async uploadFile(localPath: string, remotePath: string, hooks: FtpOperationHooks): Promise<number | undefined> {
		const sizeBytes = (await fsPromises.stat(localPath)).size;
		let bytesTransferred = 0;
		await emitUpdate(hooks, {
			bytesTotal: sizeBytes,
			bytesTransferred: 0,
			kind: "transfer",
			localPath,
			operation: "upload",
			percent: 0,
			protocol: this.connection.protocol,
			remotePath,
			stage: "start",
		});
		const stream = fs.createReadStream(localPath);
		stream.on("data", (chunk) => {
			bytesTransferred += chunk.length;
			emitUpdateDetached(hooks, {
				bytesTotal: sizeBytes,
				bytesTransferred,
				chunkBytes: chunk.length,
				kind: "transfer",
				localPath,
				operation: "upload",
				percent: buildPercent(bytesTransferred, sizeBytes),
				protocol: this.connection.protocol,
				remotePath,
				stage: "progress",
			});
		});
		await this.client.uploadFrom(stream, remotePath);
		await emitUpdate(hooks, {
			bytesTotal: sizeBytes,
			bytesTransferred: sizeBytes,
			kind: "transfer",
			localPath,
			operation: "upload",
			percent: 100,
			protocol: this.connection.protocol,
			remotePath,
			stage: "complete",
		});
		return sizeBytes;
	}

	async downloadFile(remotePath: string, localPath: string, hooks: FtpOperationHooks): Promise<number | undefined> {
		await fsPromises.mkdir(path.dirname(localPath), { recursive: true });
		const remoteStat = await this.stat(remotePath);
		const sizeBytes = remoteStat.sizeBytes;
		let bytesTransferred = 0;
		await emitUpdate(hooks, {
			...(sizeBytes !== undefined ? { bytesTotal: sizeBytes } : {}),
			bytesTransferred: 0,
			kind: "transfer",
			localPath,
			operation: "download",
			percent: 0,
			protocol: this.connection.protocol,
			remotePath,
			stage: "start",
		});
		const counter = new Transform({
			transform(chunk, _encoding, callback) {
				bytesTransferred += Buffer.byteLength(chunk);
				emitUpdateDetached(hooks, {
					...(sizeBytes !== undefined ? { bytesTotal: sizeBytes } : {}),
					bytesTransferred,
					chunkBytes: Buffer.byteLength(chunk),
					kind: "transfer",
					localPath,
					operation: "download",
					percent: buildPercent(bytesTransferred, sizeBytes),
					protocol: this.connection.protocol,
					remotePath,
					stage: "progress",
				});
				callback(null, chunk);
			},
		});
		const output = fs.createWriteStream(localPath);
		const piping = pipeline(counter, output);
		await this.client.downloadTo(counter, remotePath);
		await piping;
		await emitUpdate(hooks, {
			...(sizeBytes !== undefined ? { bytesTotal: sizeBytes } : {}),
			bytesTransferred: sizeBytes ?? bytesTransferred,
			kind: "transfer",
			localPath,
			operation: "download",
			percent: 100,
			protocol: this.connection.protocol,
			remotePath,
			stage: "complete",
		});
		return sizeBytes ?? bytesTransferred;
	}
}

class SftpDriver implements FtpDriver {
	private readonly client = new SftpClient();

	constructor(private readonly connection: FtpConnectionOptions) {}

	async connect(): Promise<void> {
		await this.client.connect({
			host: this.connection.host,
			passphrase: this.connection.passphrase,
			password: this.connection.password,
			port: this.connection.port,
			privateKey: this.connection.privateKey,
			readyTimeout: this.connection.timeoutMs,
			username: this.connection.username,
		});
	}

	async disconnect(): Promise<void> {
		await this.client.end();
	}

	async ensureDir(remotePath: string): Promise<void> {
		await this.client.mkdir(remotePath, true);
	}

	async chmod(remotePath: string, mode: number): Promise<void> {
		await this.client.chmod(remotePath, mode);
	}

	async stat(remotePath: string): Promise<RemoteStat> {
		const exists = await this.client.exists(remotePath);
		if (!exists) {
			return {
				exists: false,
				isDirectory: false,
			};
		}

		const stats = await this.client.stat(remotePath);
		const isDirectory = typeof stats.isDirectory === "function"
			? stats.isDirectory()
			: exists === "d";
		return {
			exists: true,
			isDirectory,
			...(typeof stats.size === "number" ? { sizeBytes: stats.size } : {}),
		};
	}

	async list(remotePath: string): Promise<RemoteEntry[]> {
		const entries = await this.client.list(remotePath);
		return entries
			.filter((entry) => entry.name !== "." && entry.name !== "..")
			.map((entry) => ({
				isDirectory: entry.type === "d",
				name: entry.name,
				path: resolveRemotePath(remotePath, entry.name),
				...(typeof entry.size === "number" ? { sizeBytes: entry.size } : {}),
			}));
	}

	async uploadFile(localPath: string, remotePath: string, hooks: FtpOperationHooks): Promise<number | undefined> {
		const sizeBytes = (await fsPromises.stat(localPath)).size;
		await emitUpdate(hooks, {
			bytesTotal: sizeBytes,
			bytesTransferred: 0,
			kind: "transfer",
			localPath,
			operation: "upload",
			percent: 0,
			protocol: this.connection.protocol,
			remotePath,
			stage: "start",
		});
		await this.client.fastPut(localPath, remotePath, {
			step: (bytesTransferred, chunkBytes, bytesTotal) => {
				emitUpdateDetached(hooks, {
					bytesTotal,
					bytesTransferred,
					chunkBytes,
					kind: "transfer",
					localPath,
					operation: "upload",
					percent: buildPercent(bytesTransferred, bytesTotal),
					protocol: this.connection.protocol,
					remotePath,
					stage: "progress",
				});
			},
		});
		await emitUpdate(hooks, {
			bytesTotal: sizeBytes,
			bytesTransferred: sizeBytes,
			kind: "transfer",
			localPath,
			operation: "upload",
			percent: 100,
			protocol: this.connection.protocol,
			remotePath,
			stage: "complete",
		});
		return sizeBytes;
	}

	async downloadFile(remotePath: string, localPath: string, hooks: FtpOperationHooks): Promise<number | undefined> {
		await fsPromises.mkdir(path.dirname(localPath), { recursive: true });
		const remoteStat = await this.stat(remotePath);
		const sizeBytes = remoteStat.sizeBytes;
		await emitUpdate(hooks, {
			...(sizeBytes !== undefined ? { bytesTotal: sizeBytes } : {}),
			bytesTransferred: 0,
			kind: "transfer",
			localPath,
			operation: "download",
			percent: 0,
			protocol: this.connection.protocol,
			remotePath,
			stage: "start",
		});
		await this.client.fastGet(remotePath, localPath, {
			step: (bytesTransferred, chunkBytes, bytesTotal) => {
				emitUpdateDetached(hooks, {
					bytesTotal,
					bytesTransferred,
					chunkBytes,
					kind: "transfer",
					localPath,
					operation: "download",
					percent: buildPercent(bytesTransferred, bytesTotal),
					protocol: this.connection.protocol,
					remotePath,
					stage: "progress",
				});
			},
		});
		await emitUpdate(hooks, {
			...(sizeBytes !== undefined ? { bytesTotal: sizeBytes } : {}),
			bytesTransferred: sizeBytes,
			kind: "transfer",
			localPath,
			operation: "download",
			percent: 100,
			protocol: this.connection.protocol,
			remotePath,
			stage: "complete",
		});
		return sizeBytes;
	}
}

export class FtpKit extends Kit {
	constructor() {
		super({
			id: FTP_KIT_ID,
			name: "FTP Kit",
			category: "network",
			description: "Host-side FTP, FTPS, and SFTP transport helper for $.pkg.ftp.",
			tags: ["ftp", "ftps", "sftp", "transfer"],
		});
	}

	async upload(
		connection: FtpConnectionOptions,
		options: FtpUploadOptions,
		hooks: FtpOperationHooks = {},
	): Promise<FtpUploadResult> {
		return await this.withDriver(connection, async (driver) => {
			const localPath = path.resolve(process.cwd(), options.localPath);
			const localStats = await fsPromises.stat(localPath).catch((error) => {
				throw new Error(`Upload source '${options.localPath}' is not readable: ${toErrorMessage(error)}`);
			});
			const requestedRemotePath = options.remotePath ?? path.basename(localPath);
			const absoluteRemotePath = resolveRemotePath(connection.cwd, requestedRemotePath);
			const remoteTarget = localStats.isDirectory()
				? absoluteRemotePath
				: await this.resolveUploadFileTarget(driver, absoluteRemotePath, localPath);
			const localTree = await this.collectLocalTree(localPath, remoteTarget, options.filter);
			const createdDirectories = localTree.rootIsDirectory
				? [remoteTarget, ...localTree.directories]
				: localTree.directories;

			for (const directory of uniqueStrings(createdDirectories)) {
				await driver.ensureDir(directory);
			}

			const files: FtpTransferRecord[] = [];
			let totalBytes = 0;
			for (const entry of localTree.files) {
				await driver.ensureDir(path.posix.dirname(entry.remotePath));
				const sizeBytes = await driver.uploadFile(entry.absolutePath, entry.remotePath, hooks);
				totalBytes += sizeBytes ?? entry.sizeBytes ?? 0;
				files.push({
					localPath: entry.absolutePath,
					remotePath: entry.remotePath,
					...(sizeBytes !== undefined ? { sizeBytes } : {}),
				});
			}

			return {
				...(connection.cwd ? { cwd: connection.cwd } : {}),
				fileCount: files.length,
				files,
				kind: "ftp-upload",
				protocol: connection.protocol,
				totalBytes,
				...(options.warnings && options.warnings.length > 0 ? { warnings: [...options.warnings] } : {}),
			};
		}, hooks, "upload");
	}

	async download(
		connection: FtpConnectionOptions,
		options: FtpDownloadOptions,
		hooks: FtpOperationHooks = {},
	): Promise<FtpDownloadResult> {
		return await this.withDriver(connection, async (driver) => {
			const resolvedRemotePath = resolveRemotePath(connection.cwd, options.remotePath);
			const remoteStat = await driver.stat(resolvedRemotePath);
			if (!remoteStat.exists) {
				throw new Error(`Remote path '${resolvedRemotePath}' does not exist.`);
			}

			const localTarget = options.localPath
				? path.resolve(process.cwd(), options.localPath)
				: path.resolve(process.cwd(), path.posix.basename(resolvedRemotePath));
			if (remoteStat.isDirectory) {
				const remoteTree = await this.collectRemoteTree(driver, resolvedRemotePath);
				const localRoot = localTarget;
				await fsPromises.mkdir(localRoot, { recursive: true });
				for (const directory of remoteTree.directories) {
					const relativeDirectory = path.posix.relative(resolvedRemotePath, directory);
					await fsPromises.mkdir(path.join(localRoot, ...relativeDirectory.split("/").filter(Boolean)), {
						recursive: true,
					});
				}

				const files: FtpTransferRecord[] = [];
				let totalBytes = 0;
				for (const entry of remoteTree.files) {
					const relativeFile = path.posix.relative(resolvedRemotePath, entry.path);
					const nextLocalPath = path.join(localRoot, ...relativeFile.split("/").filter(Boolean));
					const sizeBytes = await driver.downloadFile(entry.path, nextLocalPath, hooks);
					totalBytes += sizeBytes ?? entry.sizeBytes ?? 0;
					const extractedTo = options.unzip
						? await this.extractArchiveIfNeeded(connection.protocol, nextLocalPath, hooks)
						: undefined;
					files.push({
						...(extractedTo ? { extractedTo } : {}),
						localPath: nextLocalPath,
						remotePath: entry.path,
						...(sizeBytes !== undefined ? { sizeBytes } : {}),
					});
				}

				return {
					...(connection.cwd ? { cwd: connection.cwd } : {}),
					fileCount: files.length,
					files,
					kind: "ftp-download",
					protocol: connection.protocol,
					totalBytes,
					...(options.warnings && options.warnings.length > 0 ? { warnings: [...options.warnings] } : {}),
				};
			}

			const finalLocalPath = await this.resolveDownloadFileTarget(localTarget, resolvedRemotePath);
			const sizeBytes = await driver.downloadFile(resolvedRemotePath, finalLocalPath, hooks);
			const extractedTo = options.unzip
				? await this.extractArchiveIfNeeded(connection.protocol, finalLocalPath, hooks)
				: undefined;
			return {
				...(connection.cwd ? { cwd: connection.cwd } : {}),
				fileCount: 1,
				files: [{
					...(extractedTo ? { extractedTo } : {}),
					localPath: finalLocalPath,
					remotePath: resolvedRemotePath,
					...(sizeBytes !== undefined ? { sizeBytes } : {}),
				}],
				kind: "ftp-download",
				protocol: connection.protocol,
				totalBytes: sizeBytes ?? remoteStat.sizeBytes ?? 0,
				...(options.warnings && options.warnings.length > 0 ? { warnings: [...options.warnings] } : {}),
			};
		}, hooks, "download");
	}

	async mkdir(
		connection: FtpConnectionOptions,
		options: FtpMkdirOptions,
		hooks: FtpOperationHooks = {},
	): Promise<FtpMkdirResult> {
		return await this.withDriver(connection, async (driver) => {
			const remotePath = resolveRemotePath(connection.cwd, options.remotePath);
			await driver.ensureDir(remotePath);
			await emitUpdate(hooks, {
				kind: "log",
				message: `Created remote directory ${remotePath}`,
				protocol: connection.protocol,
			});
			return {
				...(connection.cwd ? { cwd: connection.cwd } : {}),
				kind: "ftp-mkdir",
				path: remotePath,
				protocol: connection.protocol,
				recursive: options.recursive !== false,
				...(options.warnings && options.warnings.length > 0 ? { warnings: [...options.warnings] } : {}),
			};
		}, hooks, "mkdir");
	}

	async chmod(
		connection: FtpConnectionOptions,
		options: FtpChmodOptions,
		hooks: FtpOperationHooks = {},
	): Promise<FtpChmodResult> {
		return await this.withDriver(connection, async (driver) => {
			const targetPath = resolveRemotePath(connection.cwd, options.targetPath);
			await driver.chmod(targetPath, options.mode);
			await emitUpdate(hooks, {
				kind: "log",
				message: `Changed permissions for ${targetPath} to ${options.mode.toString(8)}`,
				protocol: connection.protocol,
			});
			return {
				...(connection.cwd ? { cwd: connection.cwd } : {}),
				kind: "ftp-chmod",
				mode: options.mode.toString(8),
				path: targetPath,
				protocol: connection.protocol,
				...(options.warnings && options.warnings.length > 0 ? { warnings: [...options.warnings] } : {}),
			};
		}, hooks, "chmod");
	}

	private async withDriver<TResult>(
		connection: FtpConnectionOptions,
		executor: (driver: FtpDriver) => Promise<TResult>,
		hooks: FtpOperationHooks,
		operation: "chmod" | "download" | "mkdir" | "upload",
	): Promise<TResult> {
		const driver = connection.protocol === "sftp"
			? new SftpDriver(connection)
			: new BasicFtpDriver(connection);
		if (driver instanceof BasicFtpDriver) {
			await driver.connect();
		} else {
			await driver.connect();
		}

		try {
			return await executor(driver);
		} catch (error) {
			await emitUpdate(hooks, {
				error: toErrorMessage(error),
				kind: "error",
				operation,
				protocol: connection.protocol,
			});
			throw error;
		} finally {
			await driver.disconnect().catch(() => undefined);
		}
	}

	private async resolveUploadFileTarget(driver: FtpDriver, remotePath: string, localPath: string): Promise<string> {
		if (remotePath.endsWith("/")) {
			return resolveRemotePath(remotePath, path.basename(localPath));
		}

		const remoteStat = await driver.stat(remotePath);
		if (remoteStat.exists && remoteStat.isDirectory) {
			return resolveRemotePath(remotePath, path.basename(localPath));
		}

		return remotePath;
	}

	private async resolveDownloadFileTarget(localPath: string, remotePath: string): Promise<string> {
		const existingStat = await fsPromises.stat(localPath).catch(() => null);
		if (existingStat?.isDirectory()) {
			return path.join(localPath, path.posix.basename(remotePath));
		}

		if (localPath.endsWith(path.sep)) {
			return path.join(localPath, path.posix.basename(remotePath));
		}

		return localPath;
	}

	private async collectLocalTree(
		localRoot: string,
		remoteRoot: string,
		filter: FtpUploadOptions["filter"],
	): Promise<LocalTree> {
		const rootStat = await fsPromises.stat(localRoot);
		if (!rootStat.isDirectory()) {
			const singleEntry: FtpTransferFilterEntry = {
				absolutePath: localRoot,
				isDirectory: false,
				name: path.basename(localRoot),
				relativePath: "",
				remotePath: remoteRoot,
				sizeBytes: rootStat.size,
			};
			if (filter && filter(singleEntry) === false) {
				return {
					directories: [],
					files: [],
					rootIsDirectory: false,
				};
			}
			return {
				directories: [],
				files: [singleEntry],
				rootIsDirectory: false,
			};
		}

		const files: FtpTransferFilterEntry[] = [];
		const directories: string[] = [];
		const visit = async (absolutePath: string, relativePath: string): Promise<void> => {
			const entryStat = await fsPromises.stat(absolutePath);
			const remotePath = relativePath.length > 0
				? resolveRemotePath(remoteRoot, relativePath.split(path.sep).join("/"))
				: remoteRoot;
			const candidate: FtpTransferFilterEntry = {
				absolutePath,
				isDirectory: entryStat.isDirectory(),
				name: path.basename(absolutePath),
				relativePath,
				remotePath,
				...(entryStat.isFile() ? { sizeBytes: entryStat.size } : {}),
			};
			if (filter && filter(candidate) === false) {
				return;
			}

			if (entryStat.isDirectory()) {
				if (relativePath.length > 0) {
					directories.push(remotePath);
				}
				const children = await fsPromises.readdir(absolutePath, { withFileTypes: true });
				for (const child of children) {
					const nextAbsolutePath = path.join(absolutePath, child.name);
					const nextRelativePath = relativePath.length > 0
						? path.join(relativePath, child.name)
						: child.name;
					await visit(nextAbsolutePath, nextRelativePath);
				}
				return;
			}

			files.push(candidate);
		};

		await visit(localRoot, "");
		return {
			directories,
			files,
			rootIsDirectory: true,
		};
	}

	private async collectRemoteTree(driver: FtpDriver, remoteRoot: string): Promise<RemoteTree> {
		const remoteStat = await driver.stat(remoteRoot);
		if (!remoteStat.exists) {
			throw new Error(`Remote path '${remoteRoot}' does not exist.`);
		}
		if (!remoteStat.isDirectory) {
			return {
				directories: [],
				files: [{
					isDirectory: false,
					name: path.posix.basename(remoteRoot),
					path: remoteRoot,
					...(remoteStat.sizeBytes !== undefined ? { sizeBytes: remoteStat.sizeBytes } : {}),
				}],
				rootIsDirectory: false,
			};
		}

		const directories: string[] = [];
		const files: RemoteEntry[] = [];
		const walk = async (directoryPath: string): Promise<void> => {
			const entries = await driver.list(directoryPath);
			for (const entry of entries) {
				if (entry.isDirectory) {
					directories.push(entry.path);
					await walk(entry.path);
					continue;
				}

				files.push(entry);
			}
		};

		await walk(remoteRoot);
		return {
			directories,
			files,
			rootIsDirectory: true,
		};
	}

	private async extractArchiveIfNeeded(
		protocol: FtpProtocol,
		archivePath: string,
		hooks: FtpOperationHooks,
	): Promise<string | undefined> {
		if (/\.(?:tar\.gz|tgz)$/iu.test(archivePath)) {
			const outputPath = path.dirname(archivePath);
			await tar.x({
				cwd: outputPath,
				file: archivePath,
			});
			await emitUpdate(hooks, {
				archivePath,
				archiveType: "tar.gz",
				kind: "extract",
				outputPath,
				protocol,
			});
			return outputPath;
		}

		if (/\.gz$/iu.test(archivePath)) {
			const outputPath = archivePath.replace(/\.gz$/iu, "");
			await gunzipToFile(archivePath, outputPath);
			await emitUpdate(hooks, {
				archivePath,
				archiveType: "gz",
				kind: "extract",
				outputPath,
				protocol,
			});
			return outputPath;
		}

		return undefined;
	}
}