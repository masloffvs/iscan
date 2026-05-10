import { ProxyKit, type ProxyProfile, type ProxyTestResult, type ProxyType } from "../../kits/proxy-kit";
import {
	createTableEntity,
	createTextEntity,
	type OutputEntity,
	type PrimitiveTableColumn,
	type PrimitiveTableRow,
} from "../../primitives";
import { InvalidParamsError } from "../errors";
import { defineNotebookTypeOverlay, type ModuleExecutionContext } from "../module";

type EnsureProxyKitContext = Pick<ModuleExecutionContext<unknown, object>, "getProxyKit" | "runtime">;

type ProxyProfilesReportOptions = {
	title?: string;
	summaryLines?: string[];
	emptyMessage?: string;
	tableTitle?: string;
};

export const PROXY_NOTEBOOK_TYPE_OVERLAY = defineNotebookTypeOverlay("src/modules/kits/proxy.h.ts");

export const PROXY_TYPE_VALUES: readonly ProxyType[] = [
	"HTTP",
	"HTTPS",
	"SOCKS4",
	"SOCKS4A",
	"SOCKS5",
	"SOCKS5H",
];

export async function ensureProxyKit(
	context: EnsureProxyKitContext,
	reason = "module:kits/proxy",
): Promise<ProxyKit> {
	const existingKit = context.getProxyKit();
	if (existingKit) {
		return existingKit;
	}

	return await context.runtime.attachKit(new ProxyKit(), { reason });
}

export function parseOptionalString(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value !== "string") {
		throw new InvalidParamsError(`${fieldName} must be a string.`);
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function parseOptionalNumber(value: unknown, fieldName: string): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	throw new InvalidParamsError(`${fieldName} must be a valid number.`);
}

export function parseOptionalProxyType(value: unknown, fieldName: string): ProxyType | undefined {
	const normalized = parseOptionalString(value, fieldName);
	if (!normalized) {
		return undefined;
	}

	const upperCased = normalized.toUpperCase();
	if ((PROXY_TYPE_VALUES as readonly string[]).includes(upperCased)) {
		return upperCased as ProxyType;
	}

	throw new InvalidParamsError(`${fieldName} must be one of: ${PROXY_TYPE_VALUES.join(", ")}.`);
}

export function formatProxyProfileUrl(
	proxy: Pick<ProxyProfile, "type" | "host" | "port" | "username" | "password">,
): string {
	const auth = proxy.username
		? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || "")}@`
		: "";
	return `${proxy.type.toLowerCase()}://${auth}${proxy.host}:${proxy.port}`;
}

export function createProxyProfilesReport(
	kit: ProxyKit,
	options: ProxyProfilesReportOptions = {},
): OutputEntity[] {
	const proxies = kit.getProxies();
	const summaryLines = options.summaryLines ?? [
		`Proxy profiles • ${proxies.length} total`,
		"Use $.kits.proxy.import(), $.kits.proxy.replace(), $.kits.proxy.test(), $.kits.proxy.save(), and $.kits.proxy.delete() for notebook-safe proxy workflows.",
	];

	if (proxies.length === 0) {
		return [
			createTextEntity(
				[...summaryLines, "", options.emptyMessage ?? "No proxy profiles found."],
				{
					title: options.title ?? "Proxy Kit",
					tone: "info",
				},
			),
		];
	}

	const columns: PrimitiveTableColumn[] = [
		{ key: "name", header: "name" },
		{ key: "type", header: "type" },
		{ key: "endpoint", header: "endpoint" },
		{ key: "auth", header: "auth" },
		{ key: "profileId", header: "id" },
	];
	const rows: PrimitiveTableRow[] = proxies.map((proxy) => ({
		name: proxy.name,
		type: proxy.type,
		endpoint: `${proxy.host}:${proxy.port}`,
		auth: proxy.username ? "configured" : "none",
		profileId: proxy.id,
	}));

	return [
		createTextEntity(summaryLines, {
			title: options.title ?? "Proxy Kit",
			tone: "muted",
		}),
		createTableEntity(columns, rows, {
			title: options.tableTitle ?? "Saved proxy profiles",
		}),
	];
}

export function resolveProxyProfile(
	kit: ProxyKit,
	target: string | undefined,
): ProxyProfile {
	const proxies = kit.getProxies();

	if (!target) {
		if (proxies.length === 1) {
			return proxies[0] as ProxyProfile;
		}

		if (proxies.length === 0) {
			throw new InvalidParamsError(
				"No saved proxy profiles. Use $.kits.proxy.manager() to create one first.",
			);
		}

		throw new InvalidParamsError(
			"Multiple proxy profiles are available. Pass proxy=<id-or-name> or inspect them with $.kits.proxy.list().",
		);
	}

	const exactIdMatch = proxies.find((proxy) => proxy.id === target);
	if (exactIdMatch) {
		return exactIdMatch;
	}

	const exactNameMatches = proxies.filter((proxy) => proxy.name === target);
	if (exactNameMatches.length === 1) {
		return exactNameMatches[0] as ProxyProfile;
	}

	if (exactNameMatches.length > 1) {
		throw new InvalidParamsError(
			`Multiple proxy profiles match '${target}'. Use proxy=<id> instead.`,
		);
	}

	throw new InvalidParamsError(
		`Unknown proxy profile '${target}'. Use $.kits.proxy.list() to inspect saved proxies.`,
	);
}

export function findProxyProfile(
	kit: ProxyKit,
	target: string | undefined,
): ProxyProfile | null {
	if (!target) {
		return null;
	}

	const proxies = kit.getProxies();
	const exactIdMatch = proxies.find((proxy) => proxy.id === target);
	if (exactIdMatch) {
		return exactIdMatch;
	}

	const exactNameMatches = proxies.filter((proxy) => proxy.name === target);
	if (exactNameMatches.length > 1) {
		throw new InvalidParamsError(
			`Multiple proxy profiles match '${target}'. Use proxy=<id> instead.`,
		);
	}

	return exactNameMatches[0] ?? null;
}

export function ensureUniqueProxyName(
	kit: ProxyKit,
	name: string,
	options: { excludeId?: string } = {},
): void {
	const conflictingProfile = kit.getProxies().find((proxy) => (
		proxy.name === name
		&& proxy.id !== options.excludeId
	));

	if (conflictingProfile) {
		throw new InvalidParamsError(
			`Proxy name '${name}' is already used by '${conflictingProfile.id}'. Choose a different name or update that profile explicitly.`,
		);
	}
}

export function createProxyTestReport(
	proxy: ProxyProfile,
	result: ProxyTestResult,
): OutputEntity[] {
	const endpoint = `${proxy.host}:${proxy.port}`;
	const status = result.error ? "error" : "ok";
	const summaryLines = result.error
		? [
			`Proxy test • ${proxy.name}`,
			`Endpoint: ${endpoint} (${proxy.type})`,
			`Status: failed after ${result.latencyMs} ms`,
			`Error: ${result.error}`,
		]
		: [
			`Proxy test • ${proxy.name}`,
			`Endpoint: ${endpoint} (${proxy.type})`,
			`Status: reachable in ${result.latencyMs} ms`,
			`Public IP: ${result.ip}`,
			result.country ? `Country: ${result.country}` : "Country: <unknown>",
		];

	return [
		createTextEntity(summaryLines, {
			title: "Proxy test",
			tone: result.error ? "error" : "info",
		}),
		createTableEntity(
			[
				{ key: "name", header: "name" },
				{ key: "status", header: "status" },
				{ key: "type", header: "type" },
				{ key: "endpoint", header: "endpoint" },
				{ key: "latencyMs", header: "latency ms", align: "right" },
				{ key: "ip", header: "ip" },
				{ key: "country", header: "country" },
				{ key: "error", header: "error" },
			],
			[
				{
					name: proxy.name,
					status,
					type: proxy.type,
					endpoint,
					latencyMs: result.latencyMs,
					ip: result.ip,
					country: result.country ?? "",
					error: result.error ?? "",
				},
			],
			{ title: "Test result" },
		),
	];
}

export function createProxySaveReport(
	kit: ProxyKit,
	proxy: ProxyProfile,
	mode: "created" | "updated",
): OutputEntity[] {
	return [
		createTextEntity(
			[
				`${mode === "created" ? "Saved" : "Updated"} proxy profile ${proxy.name}`,
				`Endpoint: ${proxy.host}:${proxy.port} (${proxy.type})`,
				`Authentication: ${proxy.username ? "configured" : "none"}`,
				`Id: ${proxy.id}`,
			],
			{ title: "Proxy profile", tone: "info" },
		),
		...createProxyProfilesReport(kit),
	];
}

export function createProxyDeleteReport(
	kit: ProxyKit,
	proxy: ProxyProfile,
): OutputEntity[] {
	return [
		createTextEntity(
			[
				`Deleted proxy profile ${proxy.name}`,
				`Endpoint: ${proxy.host}:${proxy.port} (${proxy.type})`,
				`Id: ${proxy.id}`,
			],
			{ title: "Proxy profile", tone: "info" },
		),
		...createProxyProfilesReport(kit),
	];
}