import { type ProxyKit, type ProxyProfile, type ProxyType } from "../../kits/proxy-kit";
import { createTextEntity, type OutputEntity } from "../../primitives";
import { InvalidParamsError } from "../errors";
import { createProxyProfilesReport } from "./proxy-shared";

export type ProxyBatchMode = "append" | "replace";

type ParsedProxySeed = {
	type: ProxyType;
	host: string;
	port: number;
	username?: string;
	password?: string;
	sourceLine: string;
};

export type ProxyBatchApplyResult = {
	mode: ProxyBatchMode;
	parsedCount: number;
	ignoredCount: number;
	uniqueCount: number;
	createdCount: number;
	skippedCount: number;
	removedCount: number;
	totalCount: number;
};

const DEFAULT_PORTS: Record<ProxyType, number> = {
	HTTP: 80,
	HTTPS: 443,
	SOCKS4: 1080,
	SOCKS4A: 1080,
	SOCKS5: 1080,
	SOCKS5H: 1080,
};

const TEMPLATE_HOSTS = new Set([
	"ip",
	"host",
	"hostname",
	"domain",
	"proxy",
	"server",
	"example",
	"example.com",
	"example.org",
]);

const TEMPLATE_PORTS = new Set(["port", "<port>", "{port}"]);

function mapProtocolToProxyType(value: string): ProxyType | null {
	switch (value.trim().toLowerCase()) {
		case "http":
			return "HTTP";
		case "https":
			return "HTTPS";
		case "socks4":
			return "SOCKS4";
		case "socks4a":
			return "SOCKS4A";
		case "socks5":
			return "SOCKS5";
		case "socks5h":
			return "SOCKS5H";
		default:
			return null;
	}
}

function isPlaceholderHost(value: string): boolean {
	return TEMPLATE_HOSTS.has(value.trim().toLowerCase());
}

function isPlaceholderPort(value: string): boolean {
	return TEMPLATE_PORTS.has(value.trim().toLowerCase());
}

function isLikelyTemplateUrl(value: string): boolean {
	return /(?:\/\/)(?:ip|host|hostname|proxy|server)(?::|\/|$)/iu.test(value)
		|| /:port(?:\b|$)/iu.test(value);
}

function decodeCredential(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function normalizeProxySeed(
	input: {
		type: ProxyType;
		host: string;
		port: string | number;
		username?: string;
		password?: string;
		sourceLine: string;
		ignoreTemplate?: boolean;
	},
): ParsedProxySeed | "ignore" | null {
	const normalizedHost = input.host.trim().replace(/^\[(.*)\]$/u, "$1");
	if (!normalizedHost || /\s/u.test(normalizedHost)) {
		return null;
	}

	if (isPlaceholderHost(normalizedHost)) {
		return input.ignoreTemplate ? "ignore" : null;
	}

	const portToken = String(input.port).trim();
	if (isPlaceholderPort(portToken)) {
		return input.ignoreTemplate ? "ignore" : null;
	}

	const port = Number(portToken);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return null;
	}

	return {
		type: input.type,
		host: normalizedHost,
		port,
		username: input.username?.trim() ? input.username.trim() : undefined,
		password: input.password?.trim() ? input.password.trim() : undefined,
		sourceLine: input.sourceLine,
	};
}

function stripLineDecorators(line: string): string {
	return line
		.trim()
		.replace(/^\d+\.\s+/u, "")
		.replace(/^[-*]\s+/u, "");
}

function readFlagValue(line: string, flag: string): string | null {
	const escapedFlag = flag.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const pattern = new RegExp(`(?:^|\\s)${escapedFlag}\\s+(?:"([^"]*)"|'([^']*)'|(\\S+))`, "iu");
	const match = line.match(pattern);
	return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function parseAuthToken(value: string): { username?: string; password?: string } | null {
	const normalized = value.trim();
	if (!normalized) {
		return null;
	}

	const separatorIndex = normalized.indexOf(":");
	if (separatorIndex < 0) {
		return { username: decodeCredential(normalized) };
	}

	return {
		username: decodeCredential(normalized.slice(0, separatorIndex)),
		password: decodeCredential(normalized.slice(separatorIndex + 1)),
	};
}

function parseUrlToken(value: string, sourceLine: string): ParsedProxySeed | "ignore" | null {
	const normalizedValue = value.trim().replace(/[),;]+$/u, "");
	let url: URL;
	try {
		url = new URL(normalizedValue);
	} catch {
		return isLikelyTemplateUrl(normalizedValue) ? "ignore" : null;
	}

	const type = mapProtocolToProxyType(url.protocol.slice(0, -1));
	if (!type) {
		return null;
	}

	return normalizeProxySeed({
		type,
		host: url.hostname,
		port: url.port || String(DEFAULT_PORTS[type]),
		username: url.username ? decodeCredential(url.username) : undefined,
		password: url.password ? decodeCredential(url.password) : undefined,
		sourceLine,
		ignoreTemplate: true,
	});
}

function parseCurlProxyLine(line: string, defaultType: ProxyType): ParsedProxySeed | "ignore" | null {
	const proxyValue = readFlagValue(line, "-x");
	if (!proxyValue) {
		return null;
	}

	const parsed = proxyValue.includes("://")
		? parseUrlToken(proxyValue, line)
		: normalizeProxySeed({
			type: defaultType,
			host: proxyValue.split(":")[0] ?? "",
			port: proxyValue.split(":")[1] ?? "",
			sourceLine: line,
			ignoreTemplate: true,
		});
	if (!parsed || parsed === "ignore") {
		return parsed;
	}

	const authValue = readFlagValue(line, "-U");
	if (!authValue) {
		return parsed;
	}

	const auth = parseAuthToken(authValue);
	if (!auth) {
		return null;
	}

	return {
		...parsed,
		username: auth.username,
		password: auth.password,
	};
}

function parseProxychainsLine(line: string): ParsedProxySeed | "ignore" | null {
	const match = line.match(/^(https?|socks5h?|socks4a?)\s+(\S+)\s+(\S+)(?:\s+(\S+)\s+(\S+))?$/iu);
	if (!match) {
		return null;
	}

	const type = mapProtocolToProxyType(match[1] ?? "");
	if (!type) {
		return null;
	}

	return normalizeProxySeed({
		type,
		host: match[2] ?? "",
		port: match[3] ?? "",
		username: match[4] ? decodeCredential(match[4]) : undefined,
		password: match[5] ? decodeCredential(match[5]) : undefined,
		sourceLine: line,
		ignoreTemplate: true,
	});
}

function parseAtFormatLine(line: string, defaultType: ProxyType): ParsedProxySeed | "ignore" | null {
	const [endpoint, auth] = line.split("@", 2);
	if (!endpoint || !auth) {
		return null;
	}

	const endpointParts = endpoint.split(":").map(part => part.trim());
	const authParts = auth.split(":").map(part => part.trim());
	if (endpointParts.length !== 2 || authParts.length !== 2) {
		return null;
	}

	return normalizeProxySeed({
		type: defaultType,
		host: endpointParts[0] ?? "",
		port: endpointParts[1] ?? "",
		username: decodeCredential(authParts[0] ?? ""),
		password: decodeCredential(authParts[1] ?? ""),
		sourceLine: line,
		ignoreTemplate: true,
	});
}

function parseDelimitedLine(
	line: string,
	delimiter: ";" | "|",
	defaultType: ProxyType,
): ParsedProxySeed | "ignore" | null {
	if (!line.includes(delimiter)) {
		return null;
	}

	const parts = line.split(delimiter).map(part => part.trim());
	if (parts.length === 2) {
		return normalizeProxySeed({
			type: defaultType,
			host: parts[0] ?? "",
			port: parts[1] ?? "",
			sourceLine: line,
			ignoreTemplate: true,
		});
	}

	if (parts.length === 4) {
		return normalizeProxySeed({
			type: defaultType,
			host: parts[0] ?? "",
			port: parts[1] ?? "",
			username: decodeCredential(parts[2] ?? ""),
			password: decodeCredential(parts[3] ?? ""),
			sourceLine: line,
			ignoreTemplate: true,
		});
	}

	if (parts.length === 5) {
		const type = mapProtocolToProxyType(parts[0] ?? "");
		if (!type) {
			return null;
		}

		return normalizeProxySeed({
			type,
			host: parts[1] ?? "",
			port: parts[2] ?? "",
			username: decodeCredential(parts[3] ?? ""),
			password: decodeCredential(parts[4] ?? ""),
			sourceLine: line,
			ignoreTemplate: true,
		});
	}

	return null;
}

function parseColonLine(line: string, defaultType: ProxyType): ParsedProxySeed | "ignore" | null {
	const parts = line.split(":").map(part => part.trim());
	if (parts.length === 2) {
		return normalizeProxySeed({
			type: defaultType,
			host: parts[0] ?? "",
			port: parts[1] ?? "",
			sourceLine: line,
			ignoreTemplate: true,
		});
	}

	if (parts.length === 3) {
		const type = mapProtocolToProxyType(parts[0] ?? "");
		if (!type) {
			return null;
		}

		return normalizeProxySeed({
			type,
			host: parts[1] ?? "",
			port: parts[2] ?? "",
			sourceLine: line,
			ignoreTemplate: true,
		});
	}

	if (parts.length === 4) {
		const secondIsPort = Number.isInteger(Number(parts[1])) && Number(parts[1]) > 0;
		const fourthIsPort = Number.isInteger(Number(parts[3])) && Number(parts[3]) > 0;
		const secondLooksLikeTemplatePort = isPlaceholderPort(parts[1] ?? "");
		const fourthLooksLikeTemplatePort = isPlaceholderPort(parts[3] ?? "");

		if (secondIsPort || secondLooksLikeTemplatePort) {
			return normalizeProxySeed({
				type: defaultType,
				host: parts[0] ?? "",
				port: parts[1] ?? "",
				username: decodeCredential(parts[2] ?? ""),
				password: decodeCredential(parts[3] ?? ""),
				sourceLine: line,
				ignoreTemplate: true,
			});
		}

		if (fourthIsPort || fourthLooksLikeTemplatePort) {
			return normalizeProxySeed({
				type: defaultType,
				host: parts[2] ?? "",
				port: parts[3] ?? "",
				username: decodeCredential(parts[0] ?? ""),
				password: decodeCredential(parts[1] ?? ""),
				sourceLine: line,
				ignoreTemplate: true,
			});
		}
	}

	if (parts.length === 5) {
		const type = mapProtocolToProxyType(parts[0] ?? "");
		if (!type) {
			return null;
		}

		return normalizeProxySeed({
			type,
			host: parts[1] ?? "",
			port: parts[2] ?? "",
			username: decodeCredential(parts[3] ?? ""),
			password: decodeCredential(parts[4] ?? ""),
			sourceLine: line,
			ignoreTemplate: true,
		});
	}

	return null;
}

function parseProxyLine(line: string, defaultType: ProxyType): ParsedProxySeed | "ignore" | null {
	const normalizedLine = stripLineDecorators(line);
	if (!normalizedLine) {
		return "ignore";
	}

	if (normalizedLine.startsWith("#") || normalizedLine.startsWith("//")) {
		return "ignore";
	}

	const urlMatch = normalizedLine.match(/(?:https?|socks5h?|socks4a?):\/\/[^\s"'`]+/iu);
	if (urlMatch?.[0]) {
		return parseUrlToken(urlMatch[0], normalizedLine);
	}

	if (/(?:^|\s)-x\s+/iu.test(normalizedLine)) {
		const parsedCurl = parseCurlProxyLine(normalizedLine, defaultType);
		if (parsedCurl) {
			return parsedCurl;
		}
	}

	const proxychains = parseProxychainsLine(normalizedLine);
	if (proxychains) {
		return proxychains;
	}

	if (normalizedLine.includes("@")
		&& !normalizedLine.includes("://")) {
		const atFormat = parseAtFormatLine(normalizedLine, defaultType);
		if (atFormat) {
			return atFormat;
		}
	}

	const semicolonFormat = parseDelimitedLine(normalizedLine, ";", defaultType);
	if (semicolonFormat) {
		return semicolonFormat;
	}

	const pipeFormat = parseDelimitedLine(normalizedLine, "|", defaultType);
	if (pipeFormat) {
		return pipeFormat;
	}

	if (/[:;|@]/u.test(normalizedLine)) {
		return parseColonLine(normalizedLine, defaultType);
	}

	return "ignore";
}

function fingerprintProxyShape(proxy: Pick<ProxyProfile, "type" | "host" | "port" | "username" | "password">): string {
	return [
		proxy.type,
		proxy.host.trim().toLowerCase(),
		proxy.port,
		proxy.username?.trim() ?? "",
		proxy.password?.trim() ?? "",
	].join("\u0000");
}

function createImportedProxyName(
	seed: ParsedProxySeed,
	usedNames: Set<string>,
): string {
	const baseName = `${seed.host}:${seed.port} (${seed.type.toLowerCase()})`;
	if (!usedNames.has(baseName)) {
		return baseName;
	}

	let suffix = 2;
	let nextName = `${baseName} #${suffix}`;
	while (usedNames.has(nextName)) {
		suffix += 1;
		nextName = `${baseName} #${suffix}`;
	}

	return nextName;
}

function parseProxyBatchText(text: string, defaultType: ProxyType): {
	entries: ParsedProxySeed[];
	ignoredCount: number;
} {
	const entries: ParsedProxySeed[] = [];
	let ignoredCount = 0;

	for (const rawLine of text.split(/\r?\n/gu)) {
		const normalizedLine = rawLine.trim();
		if (!normalizedLine) {
			continue;
		}

		const parsed = parseProxyLine(normalizedLine, defaultType);
		if (parsed === "ignore") {
			ignoredCount += 1;
			continue;
		}

		if (!parsed) {
			throw new InvalidParamsError(
				`Failed to parse proxy line: ${normalizedLine}`,
			);
		}

		entries.push(parsed);
	}

	if (entries.length === 0) {
		throw new InvalidParamsError(
			"No proxy entries could be parsed. Supported formats include URI forms, ip:port:user:pass, user:pass:ip:port, curl -x/-U, and proxychains lines.",
		);
	}

	return { entries, ignoredCount };
}

export async function applyProxyBatchText(
	kit: ProxyKit,
	text: string,
	options: { mode: ProxyBatchMode; defaultType: ProxyType },
): Promise<ProxyBatchApplyResult> {
	const parsed = parseProxyBatchText(text, options.defaultType);
	const existing = kit.getProxies();
	const existingByFingerprint = new Map(
		existing.map(proxy => [fingerprintProxyShape(proxy), proxy] as const),
	);
	const usedNames = new Set<string>();
	const uniqueSeeds: ParsedProxySeed[] = [];
	const seenFingerprints = new Set<string>();
	let skippedCount = 0;

	for (const seed of parsed.entries) {
		const fingerprint = fingerprintProxyShape(seed);
		if (seenFingerprints.has(fingerprint)) {
			skippedCount += 1;
			continue;
		}

		seenFingerprints.add(fingerprint);
		uniqueSeeds.push(seed);
	}

	if (options.mode === "append") {
		const nextProfiles = existing.map(proxy => ({ ...proxy }));
		for (const proxy of nextProfiles) {
			usedNames.add(proxy.name);
		}

		let createdCount = 0;
		for (const seed of uniqueSeeds) {
			const fingerprint = fingerprintProxyShape(seed);
			if (existingByFingerprint.has(fingerprint)) {
				skippedCount += 1;
				continue;
			}

			const name = createImportedProxyName(seed, usedNames);
			usedNames.add(name);
			nextProfiles.push({
				id: crypto.randomUUID(),
				name,
				host: seed.host,
				port: seed.port,
				username: seed.username,
				password: seed.password,
				type: seed.type,
			});
			createdCount += 1;
		}

		if (createdCount > 0) {
			await kit.replaceProxies(nextProfiles);
		}

		return {
			mode: options.mode,
			parsedCount: parsed.entries.length,
			ignoredCount: parsed.ignoredCount,
			uniqueCount: uniqueSeeds.length,
			createdCount,
			skippedCount,
			removedCount: 0,
			totalCount: nextProfiles.length,
		};
	}

	const nextProfiles: ProxyProfile[] = [];
	let createdCount = 0;
	let preservedCount = 0;
	for (const seed of uniqueSeeds) {
		const fingerprint = fingerprintProxyShape(seed);
		const existingProfile = existingByFingerprint.get(fingerprint);
		if (existingProfile) {
			nextProfiles.push({ ...existingProfile });
			usedNames.add(existingProfile.name);
			preservedCount += 1;
			continue;
		}

		const name = createImportedProxyName(seed, usedNames);
		usedNames.add(name);
		nextProfiles.push({
			id: crypto.randomUUID(),
			name,
			host: seed.host,
			port: seed.port,
			username: seed.username,
			password: seed.password,
			type: seed.type,
		});
		createdCount += 1;
	}

	await kit.replaceProxies(nextProfiles);

	return {
		mode: options.mode,
		parsedCount: parsed.entries.length,
		ignoredCount: parsed.ignoredCount,
		uniqueCount: uniqueSeeds.length,
		createdCount,
		skippedCount,
		removedCount: Math.max(existing.length - preservedCount, 0),
		totalCount: nextProfiles.length,
	};
}

export function createProxyBatchReport(
	kit: ProxyKit,
	result: ProxyBatchApplyResult,
): OutputEntity[] {
	const summaryLines = [
		`Proxy ${result.mode === "append" ? "import" : "replace"} complete`,
		`Parsed entries: ${result.parsedCount}`,
		`Ignored non-proxy lines: ${result.ignoredCount}`,
		`Unique parsed entries: ${result.uniqueCount}`,
		result.mode === "append"
			? `Created profiles: ${result.createdCount}`
			: `Current profiles after replace: ${result.totalCount}`,
		`Skipped duplicates: ${result.skippedCount}`,
	];

	if (result.mode === "replace") {
		summaryLines.push(`Removed previous profiles: ${result.removedCount}`);
	}

	return [
		createTextEntity(summaryLines, {
			title: result.mode === "append" ? "Proxy import" : "Proxy replace",
			tone: "info",
		}),
		...createProxyProfilesReport(kit),
	];
}