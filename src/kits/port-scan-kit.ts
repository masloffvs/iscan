import { lookup } from "node:dns/promises";
import { createConnection, isIP, type Socket as NetSocket } from "node:net";

import { $config, type ResolvedPortScanServiceConfig } from "../config";
import {
	$storageKit,
	type PortScanOpenPortRow,
	type PortScanRunRow,
	type PersistedPortScanRunRecord,
} from "./storage-kit";
import { Kit, type KitInfo } from "./kit";

export const PORT_SCAN_KIT_ID = "port-scan";

const PORT_SCAN_KIT_INFO: KitInfo = {
	id: PORT_SCAN_KIT_ID,
	name: "PortScanKit",
	category: "network",
	description: "TCP connect port scanning with bounded concurrency and explicit per-port deadlines.",
	tags: ["network", "ports", "tcp", "scan"],
};

const DEFAULT_TOP_PORTS = 100;
const DEFAULT_CONCURRENCY = 500;
const DEFAULT_CONNECT_TIMEOUT_MS = 500;
const MAX_CONCURRENCY = 1000;
const MAX_CONNECT_TIMEOUT_MS = 5000;
const MIN_CONNECT_TIMEOUT_MS = 50;

const COMMON_TOP_PORTS = [
	80,
	443,
	22,
	21,
	25,
	53,
	110,
	143,
	3306,
	3389,
	8080,
	8443,
	587,
	993,
	995,
	445,
	139,
	135,
	389,
	636,
	1521,
	5432,
	6379,
	27017,
	5900,
	9200,
	9300,
	5601,
	5000,
	8000,
	8008,
	8081,
	8888,
	9000,
	9090,
	9092,
	9418,
	11211,
	27018,
	27019,
	2375,
	2376,
	2379,
	2380,
	6443,
	10250,
	10255,
	10257,
	10259,
	2049,
	111,
	69,
	123,
	161,
	162,
	514,
	873,
	1080,
	1433,
	1525,
	1723,
	1883,
	2048,
	2082,
	2083,
	2086,
	2087,
	2181,
	2483,
	2484,
	3000,
	3128,
	3268,
	3269,
	4369,
	4444,
	4500,
	4848,
	5060,
	5061,
	5222,
	5353,
	5433,
	5672,
	5985,
	5986,
	6000,
	6667,
	7000,
	7001,
	7070,
	7199,
	7443,
	7777,
	8090,
	8161,
	8500,
	8600,
	8787,
	9042,
	9080,
	9160,
	9999,
	10000,
	15672,
	18080,
	25565,
	50000,
] as const;

export type PortScanSelectionMode = "ports" | "topPorts";

export type PortScanRunOptions = {
	host: string;
	ports?: string | null;
	topPorts?: number | null;
	concurrency?: number | null;
	connectTimeoutMs?: number | null;
	persist?: boolean | null;
};

export type PortScanNormalizedOptions = {
	host: string;
	ports: string | null;
	topPorts: number | null;
	selectionMode: PortScanSelectionMode;
	resolvedPorts: number[];
	concurrency: number;
	connectTimeoutMs: number;
	persist: boolean;
};

export type PortScanResult = {
	host: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	ports: string | null;
	topPorts: number | null;
	selectionMode: PortScanSelectionMode;
	concurrency: number;
	connectTimeoutMs: number;
	scannedPortCount: number;
	openPorts: number[];
	openPortCount: number;
	errorMessage: string | null;
	persisted: boolean;
	scanId: string | null;
};

export type PortScanSavedScan = Omit<PortScanResult, "persisted" | "scanId"> & {
	persisted: true;
	scanId: string;
};

export type PortScanListFilters = {
	host?: string | null;
	limit?: number | null;
	offset?: number | null;
};

export type PortScanHostPolicy = {
	allowHosts: string[];
	denyHosts: string[];
	allowPrivateAddresses: boolean;
	allowLoopback: boolean;
	denyPublicAddresses: boolean;
};

export type PortScanCommandExamples = {
	scan: string[];
	list: string[];
	get: string[];
};

export type PortScanPolicySnapshot = {
	policy: PortScanHostPolicy;
	defaults: {
		topPorts: number;
		concurrency: number;
		connectTimeoutMs: number;
	};
	maxTopPorts: number;
	topPortsPreview: number[];
	examples: PortScanCommandExamples;
};

type PortScanTargetPatternMatch = {
	pattern: string;
	target: string;
};

type PortProbeSocket = Pick<NetSocket, "once" | "removeListener" | "destroy" | "end">;
type TcpConnectionFactory = (host: string, port: number) => PortProbeSocket;

function normalizeHost(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("host must be a string.");
	}

	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new Error("host must be a non-empty string.");
	}

	if (/\s/u.test(normalized)) {
		throw new Error("host must not contain whitespace.");
	}

	return normalized;
}

function escapeRegExp(value: string): string {
	return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

function matchesHostPattern(host: string, pattern: string): boolean {
	const normalizedHost = host.toLowerCase();
	const normalizedPattern = pattern.trim().toLowerCase();
	if (normalizedPattern.length === 0) {
		return false;
	}

	const source = `^${normalizedPattern.split("*").map(escapeRegExp).join(".*")}$`;
	return new RegExp(source, "u").test(normalizedHost);
}

function findMatchingHostPattern(host: string, patterns: readonly string[]): string | null {
	for (const pattern of patterns) {
		if (matchesHostPattern(host, pattern)) {
			return pattern;
		}
	}

	return null;
}

function parseIpv4Segments(address: string): [number, number, number, number] | null {
	const segments = address.split(".").map((segment) => Number.parseInt(segment, 10));
	if (segments.length !== 4 || segments.some((segment) => !Number.isInteger(segment) || segment < 0 || segment > 255)) {
		return null;
	}

	return [segments[0]!, segments[1]!, segments[2]!, segments[3]!];
}

function parseIpv4ToBigInt(address: string): bigint | null {
	const segments = parseIpv4Segments(address);
	if (!segments) {
		return null;
	}

	let value = 0n;
	for (const segment of segments) {
		value = (value << 8n) | BigInt(segment);
	}

	return value;
}

function parseIpv6ToBigInt(address: string): bigint | null {
	let normalized = address.trim().toLowerCase();
	const zoneIndex = normalized.indexOf("%");
	if (zoneIndex >= 0) {
		normalized = normalized.slice(0, zoneIndex);
	}

	if (normalized.includes(".")) {
		const lastColonIndex = normalized.lastIndexOf(":");
		if (lastColonIndex < 0) {
			return null;
		}

		const ipv4Segments = parseIpv4Segments(normalized.slice(lastColonIndex + 1));
		if (!ipv4Segments) {
			return null;
		}

		normalized = `${normalized.slice(0, lastColonIndex)}:${((ipv4Segments[0] ?? 0) << 8 | (ipv4Segments[1] ?? 0)).toString(16)}:${((ipv4Segments[2] ?? 0) << 8 | (ipv4Segments[3] ?? 0)).toString(16)}`;
	}

	const parts = normalized.split("::");
	if (parts.length > 2) {
		return null;
	}

	const left = parts[0] ? parts[0].split(":").filter(Boolean) : [];
	const right = parts.length === 2 && parts[1] ? parts[1].split(":").filter(Boolean) : [];
	const expanded = parts.length === 1
		? left
		: [...left, ...Array.from({ length: 8 - left.length - right.length }, () => "0"), ...right];
	if (expanded.length !== 8) {
		return null;
	}

	let value = 0n;
	for (const segment of expanded) {
		const parsed = Number.parseInt(segment, 16);
		if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) {
			return null;
		}

		value = (value << 16n) | BigInt(parsed);
	}

	return value;
}

function parseIpToBigInt(address: string): { family: 4 | 6; value: bigint } | null {
	const family = isIP(address);
	if (family === 4) {
		const value = parseIpv4ToBigInt(address);
		return value === null ? null : { family, value };
	}

	if (family === 6) {
		const value = parseIpv6ToBigInt(address);
		return value === null ? null : { family, value };
	}

	return null;
}

function parseCidrPattern(pattern: string): { family: 4 | 6; prefixLength: number; networkPrefix: bigint } | null {
	const normalized = pattern.trim().toLowerCase();
	const slashIndex = normalized.lastIndexOf("/");
	if (slashIndex <= 0 || slashIndex === normalized.length - 1) {
		return null;
	}

	const base = normalized.slice(0, slashIndex);
	const prefixValue = Number.parseInt(normalized.slice(slashIndex + 1), 10);
	if (!Number.isInteger(prefixValue)) {
		return null;
	}

	const parsedBase = parseIpToBigInt(base);
	if (!parsedBase) {
		return null;
	}

	const maxPrefixLength = parsedBase.family === 4 ? 32 : 128;
	if (prefixValue < 0 || prefixValue > maxPrefixLength) {
		return null;
	}

	const shift = BigInt(maxPrefixLength - prefixValue);
	return {
		family: parsedBase.family,
		prefixLength: prefixValue,
		networkPrefix: shift > 0n ? (parsedBase.value >> shift) : parsedBase.value,
	};
}

function matchesTargetPattern(target: string, pattern: string): boolean {
	const normalizedTarget = target.trim().toLowerCase();
	if (normalizedTarget.length === 0) {
		return false;
	}

	const cidrPattern = parseCidrPattern(pattern);
	if (!cidrPattern) {
		return matchesHostPattern(normalizedTarget, pattern);
	}

	const parsedTarget = parseIpToBigInt(normalizedTarget);
	if (!parsedTarget || parsedTarget.family !== cidrPattern.family) {
		return false;
	}

	const maxPrefixLength = parsedTarget.family === 4 ? 32 : 128;
	const shift = BigInt(maxPrefixLength - cidrPattern.prefixLength);
	const targetPrefix = shift > 0n ? (parsedTarget.value >> shift) : parsedTarget.value;
	return targetPrefix === cidrPattern.networkPrefix;
}

function findMatchingTargetPattern(targets: readonly string[], patterns: readonly string[]): PortScanTargetPatternMatch | null {
	for (const pattern of patterns) {
		for (const target of targets) {
			if (matchesTargetPattern(target, pattern)) {
				return {
					pattern,
					target,
				};
			}
		}
	}

	return null;
}

function isIpv4PrivateLike(address: string): boolean {
	const segments = parseIpv4Segments(address);
	if (!segments) {
		return false;
	}

	const [first, second] = segments;
	if (first === 10) {
		return true;
	}
	if (first === 172 && second >= 16 && second <= 31) {
		return true;
	}
	if (first === 192 && second === 168) {
		return true;
	}
	if (first === 169 && second === 254) {
		return true;
	}
	if (first === 100 && second >= 64 && second <= 127) {
		return true;
	}

	return false;
}

function isIpv4Loopback(address: string): boolean {
	return address.startsWith("127.");
}

function isIpv6Loopback(address: string): boolean {
	return address.trim().toLowerCase() === "::1";
}

function isIpv6PrivateLike(address: string): boolean {
	const normalized = address.trim().toLowerCase();
	return normalized.startsWith("fc")
		|| normalized.startsWith("fd")
		|| normalized.startsWith("fe8")
		|| normalized.startsWith("fe9")
		|| normalized.startsWith("fea")
		|| normalized.startsWith("feb");
}

function classifyResolvedAddress(address: string): "loopback" | "private" | "public" {
	const family = isIP(address);
	if (family === 4) {
		if (isIpv4Loopback(address)) {
			return "loopback";
		}
		if (isIpv4PrivateLike(address)) {
			return "private";
		}
		return "public";
	}

	if (family === 6) {
		if (isIpv6Loopback(address)) {
			return "loopback";
		}
		if (isIpv6PrivateLike(address)) {
			return "private";
		}
		return "public";
	}

	return "public";
}

function getPortScanHostPolicy(): PortScanHostPolicy {
	return {
		allowHosts: [...$config.services.portScan.allowHosts],
		denyHosts: [...$config.services.portScan.denyHosts],
		allowPrivateAddresses: $config.services.portScan.allowPrivateAddresses,
		allowLoopback: $config.services.portScan.allowLoopback,
		denyPublicAddresses: $config.services.portScan.denyPublicAddresses,
	};
}

function createPortScanCommandExamples(): PortScanCommandExamples {
	return {
		scan: [
			'await $.kits.portScan.scan({ host: "127.0.0.1", topPorts: 25 })',
			'await $.kits.portScan.scan({ host: "10.0.0.15", ports: "22,80,443,3000-3010", concurrency: 250, connectTimeoutMs: 250 })',
		],
		list: [
			"await $.kits.portScan.list()",
			'await $.kits.portScan.list({ host: "127.0.0.1", limit: 10 })',
		],
		get: [
			'await $.kits.portScan.get("SCAN_ID_HERE")',
		],
	};
}

async function resolveHostAddresses(host: string): Promise<string[]> {
	if (isIP(host) > 0) {
		return [host];
	}

	const entries = await lookup(host, { all: true, verbatim: false });
	return [...new Set(entries.map((entry) => entry.address).filter((address) => address.trim().length > 0))];
}

function createBlockedTargetMessage(host: string, message: string): Error {
	return new Error(`Port scan target '${host}' is blocked: ${message}`);
}

export async function assertPortScanTargetAllowed(
	host: string,
	policy: ResolvedPortScanServiceConfig,
): Promise<void> {
	const deniedByHostPattern = findMatchingTargetPattern([host], policy.denyHosts);
	if (deniedByHostPattern) {
		throw createBlockedTargetMessage(host, `matched services.portScan.DENY_HOSTS entry '${deniedByHostPattern.pattern}' via target '${deniedByHostPattern.target}'.`);
	}

	const allowedByHostPattern = findMatchingTargetPattern([host], policy.allowHosts);

	let resolvedAddresses: string[];
	try {
		resolvedAddresses = await resolveHostAddresses(host);
	} catch (error) {
		if (allowedByHostPattern) {
			return;
		}

		if (policy.denyPublicAddresses) {
			throw createBlockedTargetMessage(
				host,
				`it could not be resolved for policy validation. Add an explicit services.portScan.ALLOW_HOSTS entry if this target is intentional. (${error instanceof Error ? error.message : String(error)})`,
			);
		}

		return;
	}

	const deniedByResolvedPattern = findMatchingTargetPattern(resolvedAddresses, policy.denyHosts);
	if (deniedByResolvedPattern) {
		throw createBlockedTargetMessage(
			host,
			`resolved address '${deniedByResolvedPattern.target}' matched services.portScan.DENY_HOSTS entry '${deniedByResolvedPattern.pattern}'.`,
		);
	}

	if (allowedByHostPattern) {
		return;
	}

	if (resolvedAddresses.length === 0) {
		if (policy.denyPublicAddresses) {
			throw createBlockedTargetMessage(host, "no addresses were resolved and public targets are denied by default.");
		}
		return;
	}

	const allowedByResolvedPattern = findMatchingTargetPattern(resolvedAddresses, policy.allowHosts);
	if (allowedByResolvedPattern) {
		return;
	}

	const loopbackAddresses = resolvedAddresses.filter((address) => classifyResolvedAddress(address) === "loopback");
	if (loopbackAddresses.length > 0 && !policy.allowLoopback) {
		throw createBlockedTargetMessage(host, `resolved to loopback address(es) ${loopbackAddresses.join(", ")}, but services.portScan.ALLOW_LOOPBACK is false.`);
	}

	const privateAddresses = resolvedAddresses.filter((address) => classifyResolvedAddress(address) === "private");
	if (privateAddresses.length > 0 && !policy.allowPrivateAddresses) {
		throw createBlockedTargetMessage(host, `resolved to private/link-local address(es) ${privateAddresses.join(", ")}, but services.portScan.ALLOW_PRIVATE_ADDRESSES is false.`);
	}

	const publicAddresses = resolvedAddresses.filter((address) => classifyResolvedAddress(address) === "public");
	if (publicAddresses.length > 0 && policy.denyPublicAddresses) {
		throw createBlockedTargetMessage(
			host,
			`resolved to public address(es) ${publicAddresses.join(", ")}, and services.portScan.DENY_PUBLIC_ADDRESSES is true. Add an explicit services.portScan.ALLOW_HOSTS entry to allow this host deliberately.`,
		);
	}
}

function normalizeOptionalPorts(value: unknown): string | null {
	if (value === undefined || value === null || value === "") {
		return null;
	}

	if (typeof value !== "string") {
		throw new Error("ports must be a string.");
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalPositiveInteger(
	value: unknown,
	fieldName: string,
	options: { min?: number; max?: number } = {},
): number | null {
	if (value === undefined || value === null || value === "") {
		return null;
	}

	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(numericValue)) {
		throw new Error(`${fieldName} must be an integer.`);
	}

	const minimum = options.min ?? 1;
	const maximum = options.max ?? Number.MAX_SAFE_INTEGER;
	if (numericValue < minimum || numericValue > maximum) {
		throw new Error(`${fieldName} must be between ${minimum} and ${maximum}.`);
	}

	return numericValue;
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
	if (value === undefined || value === null || value === "") {
		return null;
	}

	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value === "number") {
		if (value === 1) {
			return true;
		}
		if (value === 0) {
			return false;
		}
	}

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (["true", "1", "yes", "on", "y"].includes(normalized)) {
			return true;
		}
		if (["false", "0", "no", "off", "n"].includes(normalized)) {
			return false;
		}
	}

	throw new Error("persist must be a boolean.");
}

function normalizePort(port: number, label: string): number {
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`${label} must be an integer between 1 and 65535.`);
	}

	return port;
}

function parsePortsExpression(expression: string): number[] {
	const segments = expression
		.split(",")
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);

	if (segments.length === 0) {
		throw new Error("ports must contain at least one port or range.");
	}

	const ports = new Set<number>();
	for (const segment of segments) {
		const rangeMatch = segment.match(/^(\d+)-(\d+)$/u);
		if (rangeMatch) {
			const start = normalizePort(Number.parseInt(rangeMatch[1] ?? "", 10), `ports range start '${segment}'`);
			const end = normalizePort(Number.parseInt(rangeMatch[2] ?? "", 10), `ports range end '${segment}'`);
			if (start > end) {
				throw new Error(`ports range '${segment}' must have start <= end.`);
			}

			for (let port = start; port <= end; port += 1) {
				ports.add(port);
			}
			continue;
		}

		const singlePort = Number.parseInt(segment, 10);
		if (!Number.isInteger(singlePort)) {
			throw new Error(`ports segment '${segment}' must be a port or range like 80-443.`);
		}

		ports.add(normalizePort(singlePort, `ports value '${segment}'`));
	}

	return [...ports].sort((left, right) => left - right);
}

function createTcpConnection(host: string, port: number): PortProbeSocket {
	return createConnection({ host, port });
}

export async function checkPort(
	host: string,
	port: number,
	connectTimeoutMs: number,
	connectToTarget: TcpConnectionFactory = createTcpConnection,
): Promise<number | null> {
	return await new Promise((resolve) => {
		let socket: PortProbeSocket;
		try {
			socket = connectToTarget(host, port);
		} catch {
			resolve(null);
			return;
		}

		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;

		const cleanup = () => {
			socket.removeListener("connect", handleConnect);
			socket.removeListener("error", handleError);
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
		};

		const finish = (result: number | null, closeMode: "destroy" | "end" | null) => {
			if (settled) {
				return;
			}

			settled = true;
			cleanup();

			try {
				if (closeMode === "destroy") {
					socket.destroy();
				} else if (closeMode === "end") {
					socket.end();
				}
			} catch {
				// Socket teardown should not change the probe result.
			}

			resolve(result);
		};

		const handleConnect = () => {
			finish(port, "end");
		};

		const handleError = () => {
			finish(null, "destroy");
		};

		socket.once("connect", handleConnect);
		socket.once("error", handleError);
		timeoutId = setTimeout(() => {
			finish(null, "destroy");
		}, connectTimeoutMs);
	});
}

function createPersistedPortScanRunRecord(
	scanId: string,
	result: PortScanResult,
): PersistedPortScanRunRecord {
	return {
		scanId,
		host: result.host,
		requestedPorts: result.ports,
		requestedTopPorts: result.topPorts,
		selectionMode: result.selectionMode,
		scannedPortCount: result.scannedPortCount,
		openPortCount: result.openPortCount,
		concurrency: result.concurrency,
		connectTimeoutMs: result.connectTimeoutMs,
		startedAt: result.startedAt,
		finishedAt: result.finishedAt,
		durationMs: result.durationMs,
		errorMessage: result.errorMessage,
	};
}

function groupOpenPorts(rows: readonly PortScanOpenPortRow[]): Map<string, number[]> {
	const grouped = new Map<string, number[]>();
	for (const row of rows) {
		const current = grouped.get(row.scan_id);
		if (current) {
			current.push(row.port);
			continue;
		}

		grouped.set(row.scan_id, [row.port]);
	}

	return grouped;
}

function createSavedScan(row: PortScanRunRow, openPorts: readonly number[]): PortScanSavedScan {
	return {
		host: row.host,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		durationMs: row.duration_ms,
		ports: row.requested_ports,
		topPorts: row.requested_top_ports,
		selectionMode: row.selection_mode as PortScanSelectionMode,
		concurrency: row.concurrency,
		connectTimeoutMs: row.connect_timeout_ms,
		scannedPortCount: row.scanned_port_count,
		openPorts: [...openPorts],
		openPortCount: row.open_port_count,
		errorMessage: row.error_message,
		persisted: true,
		scanId: row.scan_id,
	};
}

export function normalizePortScanOptions(options: PortScanRunOptions): PortScanNormalizedOptions {
	const host = normalizeHost(options.host);
	const ports = normalizeOptionalPorts(options.ports);
	const topPorts = normalizeOptionalPositiveInteger(options.topPorts, "topPorts", {
		min: 1,
		max: COMMON_TOP_PORTS.length,
	});

	if (ports && topPorts !== null) {
		throw new Error("Pass either ports or topPorts, not both.");
	}

	const resolvedPorts = ports
		? parsePortsExpression(ports)
		: COMMON_TOP_PORTS.slice(0, topPorts ?? DEFAULT_TOP_PORTS);

	return {
		host,
		ports,
		topPorts: ports ? null : (topPorts ?? DEFAULT_TOP_PORTS),
		selectionMode: ports ? "ports" : "topPorts",
		resolvedPorts,
		concurrency: normalizeOptionalPositiveInteger(options.concurrency, "concurrency", {
			min: 1,
			max: MAX_CONCURRENCY,
		}) ?? DEFAULT_CONCURRENCY,
		connectTimeoutMs: normalizeOptionalPositiveInteger(options.connectTimeoutMs, "connectTimeoutMs", {
			min: MIN_CONNECT_TIMEOUT_MS,
			max: MAX_CONNECT_TIMEOUT_MS,
		}) ?? DEFAULT_CONNECT_TIMEOUT_MS,
		persist: normalizeOptionalBoolean(options.persist) ?? true,
	};
}

export class PortScanKit extends Kit {
	constructor() {
		super(PORT_SCAN_KIT_INFO);
	}

	getCommonTopPorts(): readonly number[] {
		return COMMON_TOP_PORTS;
	}

	getPolicySnapshot(): PortScanPolicySnapshot {
		return {
			policy: getPortScanHostPolicy(),
			defaults: {
				topPorts: DEFAULT_TOP_PORTS,
				concurrency: DEFAULT_CONCURRENCY,
				connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
			},
			maxTopPorts: COMMON_TOP_PORTS.length,
			topPortsPreview: COMMON_TOP_PORTS.slice(0, 16),
			examples: createPortScanCommandExamples(),
		};
	}

	async listScans(filters: PortScanListFilters = {}): Promise<PortScanSavedScan[]> {
		const limit = filters.limit && Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 50;
		const offset = filters.offset && Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;
		const host = typeof filters.host === "string" ? filters.host.trim() : undefined;
		const rows = $storageKit.selectPortScanRuns(limit, offset, host);
		const openPortsByScanId = groupOpenPorts($storageKit.selectPortScanOpenPortsByScanIds(rows.map((row) => row.scan_id)));
		return rows.map((row) => createSavedScan(row, openPortsByScanId.get(row.scan_id) ?? []));
	}

	async getScan(scanId: string): Promise<PortScanSavedScan | null> {
		const normalizedScanId = scanId.trim();
		if (normalizedScanId.length === 0) {
			return null;
		}

		const row = $storageKit.selectPortScanRunById(normalizedScanId);
		if (!row) {
			return null;
		}

		const openPorts = $storageKit.selectPortScanOpenPortsByScanIds([normalizedScanId]).map((entry) => entry.port);
		return createSavedScan(row, openPorts);
	}

	async scan(options: PortScanRunOptions): Promise<PortScanResult> {
		const normalized = normalizePortScanOptions(options);
		await assertPortScanTargetAllowed(normalized.host, $config.services.portScan);
		const startedAt = new Date().toISOString();
		const startedAtMs = Date.now();
		const openPorts: number[] = [];
		let nextIndex = 0;

		const workerCount = Math.min(normalized.concurrency, normalized.resolvedPorts.length);
		await Promise.all(
			Array.from({ length: workerCount }, async () => {
				while (nextIndex < normalized.resolvedPorts.length) {
					const currentIndex = nextIndex;
					nextIndex += 1;
					const port = normalized.resolvedPorts[currentIndex];
					if (!port) {
						continue;
					}

					const result = await checkPort(normalized.host, port, normalized.connectTimeoutMs);
					if (result !== null) {
						openPorts.push(result);
					}
				}
			}),
		);

		openPorts.sort((left, right) => left - right);
		const finishedAt = new Date().toISOString();
		const scanId = normalized.persist ? crypto.randomUUID() : null;
		const result: PortScanResult = {
			host: normalized.host,
			startedAt,
			finishedAt,
			durationMs: Date.now() - startedAtMs,
			ports: normalized.ports,
			topPorts: normalized.topPorts,
			selectionMode: normalized.selectionMode,
			concurrency: normalized.concurrency,
			connectTimeoutMs: normalized.connectTimeoutMs,
			scannedPortCount: normalized.resolvedPorts.length,
			openPorts,
			openPortCount: openPorts.length,
			errorMessage: null,
			persisted: false,
			scanId: null,
		};

		if (scanId) {
			$storageKit.upsertPortScanRun(createPersistedPortScanRunRecord(scanId, result));
			$storageKit.replacePortScanOpenPorts(scanId, openPorts);
			return {
				...result,
				persisted: true,
				scanId,
			};
		}

		return result;
	}
}