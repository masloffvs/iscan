import { Resolver } from "node:dns/promises";

import { Kit, type KitInfo } from "./kit";

export const DOMAIN_LOOKUP_KIT_ID = "domain-lookup";

const DOMAIN_LOOKUP_KIT_INFO: KitInfo = {
	id: DOMAIN_LOOKUP_KIT_ID,
	name: "DomainLookupKit",
	category: "network",
	description: "Resolve DNS records and RDAP metadata for domain reconnaissance.",
	tags: ["dns", "domain", "rdap", "recon"],
};

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RDAP_BASE_URL = "https://rdap.org";

export type DomainLookupKitOptions = {
	timeoutMs?: number;
	rdapBaseUrl?: string;
	rdapEnabled?: boolean;
	dnsServers?: string[];
};

export type DomainLookupRequest = {
	includeAny?: boolean;
	includeRdap?: boolean;
	includeReverse?: boolean;
};

export type DomainLookupRecord = {
	type: string;
	value: string;
	details?: string;
};

export type DomainLookupSectionError = {
	source: "dns" | "rdap" | "reverse";
	scope: string;
	message: string;
	code?: string;
};

export type DomainRdapEvent = {
	action: string;
	timestamp?: string;
	actor?: string;
};

export type DomainRdapEntitySummary = {
	handle?: string;
	name?: string;
	email?: string;
	roles: string[];
};

export type DomainRdapInfo = {
	handle?: string;
	ldhName?: string;
	unicodeName?: string;
	status: string[];
	nameservers: string[];
	entities: DomainRdapEntitySummary[];
	registrar?: DomainRdapEntitySummary;
	events: DomainRdapEvent[];
	notices: string[];
	secureDns?: string;
	url?: string;
};

export type DomainLookupResult = {
	domain: string;
	queriedAt: string;
	records: DomainLookupRecord[];
	rdap: DomainRdapInfo | null;
	errors: DomainLookupSectionError[];
};

type RdapEntity = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStringArray(values: string[] | undefined): string[] {
	if (!values) {
		return [];
	}

	return values.map(value => value.trim()).filter(Boolean);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}

	return left.every((value, index) => value === right[index]);
}

function normalizeRdapBaseUrl(value: string | undefined): string {
	return (value ?? DEFAULT_RDAP_BASE_URL).replace(/\/+$/u, "");
}

function stringifyCompact(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}

	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	if (Array.isArray(value)) {
		return value.map(item => stringifyCompact(item)).filter(Boolean).join(", ");
	}

	if (isRecord(value)) {
		return Object.entries(value)
			.map(([key, entryValue]) => `${key}=${stringifyCompact(entryValue)}`)
			.filter(text => !text.endsWith("="))
			.join("; ");
	}

	return String(value);
}

function formatLookupError(error: unknown): { message: string; code?: string } {
	if (isRecord(error)) {
		const code = typeof error.code === "string" ? error.code : undefined;
		const message = typeof error.message === "string"
			? error.message
			: (typeof error.errno === "string" ? error.errno : undefined);
		if (message) {
			return { message, code };
		}
	}

	if (error instanceof Error) {
		return { message: error.message };
	}

	return { message: String(error) };
}

function isBenignLookupError(error: DomainLookupSectionError): boolean {
	return error.code === "ENOTFOUND"
		|| error.code === "ENODATA"
		|| error.code === "ENOTIMP";
}

function normalizeDomain(rawValue: string): string {
	let value = rawValue.trim();
	if (value.length === 0) {
		throw new Error("Domain is empty.");
	}

	if (value.includes("://")) {
		value = new URL(value).hostname;
	}

	value = value.split("/")[0] ?? value;
	value = value.replace(/\.+$/u, "").trim().toLowerCase();
	if (value.length === 0) {
		throw new Error("Domain is empty.");
	}

	const hostname = new URL(`http://${value}`).hostname.replace(/\.+$/u, "").toLowerCase();
	if (hostname.length === 0) {
		throw new Error(`Invalid domain: ${rawValue}`);
	}

	return hostname;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			operation,
			new Promise<never>((_resolve, reject) => {
				timeoutId = setTimeout(() => {
					reject(new Error(`${label} timed out after ${timeoutMs}ms`));
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
}

function dedupeRecords(records: readonly DomainLookupRecord[]): DomainLookupRecord[] {
	const seen = new Set<string>();
	const unique: DomainLookupRecord[] = [];

	for (const record of records) {
		const key = `${record.type}\u0000${record.value}\u0000${record.details ?? ""}`;
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		unique.push(record);
	}

	return unique;
}

function sortRecords(records: readonly DomainLookupRecord[]): DomainLookupRecord[] {
	const order = new Map<string, number>([
		["A", 1],
		["AAAA", 2],
		["CNAME", 3],
		["NS", 4],
		["MX", 5],
		["TXT", 6],
		["CAA", 7],
		["SOA", 8],
		["SRV", 9],
		["NAPTR", 10],
		["PTR", 11],
		["ANY", 12],
	]);

	return [...records].sort((left, right) => {
		const leftOrder = order.get(left.type) ?? 999;
		const rightOrder = order.get(right.type) ?? 999;
		if (leftOrder !== rightOrder) {
			return leftOrder - rightOrder;
		}

		const valueCompare = left.value.localeCompare(right.value);
		if (valueCompare !== 0) {
			return valueCompare;
		}

		return (left.details ?? "").localeCompare(right.details ?? "");
	});
}

function filterLookupErrors(
	errors: readonly DomainLookupSectionError[],
	hasSuccessfulLookup: boolean,
): DomainLookupSectionError[] {
	if (!hasSuccessfulLookup) {
		return [...errors];
	}

	return errors.filter(error => !isBenignLookupError(error));
}

function readVcardField(entity: RdapEntity, fieldName: string): string | undefined {
	const vcardArray = entity.vcardArray;
	if (!Array.isArray(vcardArray) || vcardArray.length < 2 || vcardArray[0] !== "vcard") {
		return undefined;
	}

	const entries = vcardArray[1];
	if (!Array.isArray(entries)) {
		return undefined;
	}

	for (const entry of entries) {
		if (!Array.isArray(entry) || entry.length < 4 || entry[0] !== fieldName) {
			continue;
		}

		const value = entry[3];
		const text = stringifyCompact(value).trim();
		if (text.length > 0) {
			return text;
		}
	}

	return undefined;
}

function toRdapEntitySummary(entity: RdapEntity): DomainRdapEntitySummary {
	const roles = Array.isArray(entity.roles)
		? entity.roles.filter((role): role is string => typeof role === "string")
		: [];

	return {
		handle: typeof entity.handle === "string" ? entity.handle : undefined,
		name: readVcardField(entity, "fn") ?? readVcardField(entity, "org"),
		email: readVcardField(entity, "email"),
		roles,
	};
}

function formatAnyRecord(record: unknown): DomainLookupRecord {
	if (!isRecord(record)) {
		return {
			type: "ANY",
			value: stringifyCompact(record) || "unknown",
		};
	}

	const rawType = typeof record.type === "string" ? record.type : "ANY";
	const { type: _type, entries, value, exchange, address, ...rest } = record;
	const primaryValue = stringifyCompact(value)
		|| stringifyCompact(address)
		|| stringifyCompact(exchange)
		|| stringifyCompact(entries)
		|| rawType;
	const details = stringifyCompact(rest);

	return {
		type: rawType,
		value: primaryValue,
		details: details || undefined,
	};
}

export class DomainLookupKit extends Kit {
	private readonly resolver: Resolver;
	private readonly timeoutMs: number;
	private readonly rdapBaseUrl: string;
	private readonly rdapEnabled: boolean;
	private readonly dnsServers: string[];

	constructor(options: DomainLookupKitOptions = {}) {
		super(DOMAIN_LOOKUP_KIT_INFO);
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.rdapBaseUrl = normalizeRdapBaseUrl(options.rdapBaseUrl);
		this.rdapEnabled = options.rdapEnabled ?? true;
		this.dnsServers = normalizeStringArray(options.dnsServers);
		this.resolver = new Resolver();

		if (this.dnsServers.length > 0) {
			this.resolver.setServers(this.dnsServers);
		}
	}

	getTimeoutMs(): number {
		return this.timeoutMs;
	}

	getRdapBaseUrl(): string {
		return this.rdapBaseUrl;
	}

	isRdapEnabled(): boolean {
		return this.rdapEnabled;
	}

	getDnsServers(): string[] {
		return [...this.dnsServers];
	}

	matchesOptions(options: DomainLookupKitOptions = {}): boolean {
		return (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) === this.timeoutMs
			&& normalizeRdapBaseUrl(options.rdapBaseUrl) === this.rdapBaseUrl
			&& (options.rdapEnabled ?? true) === this.rdapEnabled
			&& arraysEqual(normalizeStringArray(options.dnsServers), this.dnsServers);
	}

	async lookupDomain(rawDomain: string, request: DomainLookupRequest = {}): Promise<DomainLookupResult> {
		const domain = normalizeDomain(rawDomain);
		const includeAny = request.includeAny ?? true;
		const includeRdap = request.includeRdap ?? this.rdapEnabled;
		const includeReverse = request.includeReverse ?? true;
		const errors: DomainLookupSectionError[] = [];

		const recordSets = await Promise.all([
			this.runLookup("dns", "A", () => this.resolver.resolve4(domain), errors, addresses => addresses.map(address => ({
				type: "A",
				value: address,
			}))),
			this.runLookup("dns", "AAAA", () => this.resolver.resolve6(domain), errors, addresses => addresses.map(address => ({
				type: "AAAA",
				value: address,
			}))),
			this.runLookup("dns", "CNAME", () => this.resolver.resolveCname(domain), errors, values => values.map(value => ({
				type: "CNAME",
				value,
			}))),
			this.runLookup("dns", "NS", () => this.resolver.resolveNs(domain), errors, values => values.map(value => ({
				type: "NS",
				value,
			}))),
			this.runLookup("dns", "MX", () => this.resolver.resolveMx(domain), errors, values => values.map(value => ({
				type: "MX",
				value: value.exchange.trim().length > 0 ? value.exchange : "(null MX)",
				details: `priority=${value.priority}`,
			}))),
			this.runLookup("dns", "TXT", () => this.resolver.resolveTxt(domain), errors, values => values.map(value => ({
				type: "TXT",
				value: value.join(""),
			}))),
			this.runLookup("dns", "CAA", () => this.resolver.resolveCaa(domain), errors, values => values.map(value => ({
				type: "CAA",
				value: [
					value.issue ? `issue=${value.issue}` : undefined,
					value.issuewild ? `issuewild=${value.issuewild}` : undefined,
					value.iodef ? `iodef=${value.iodef}` : undefined,
				].filter(Boolean).join("; ") || "policy",
				details: `critical=${value.critical}`,
			}))),
			this.runLookup("dns", "SOA", () => this.resolver.resolveSoa(domain), errors, value => [{
				type: "SOA",
				value: value.nsname,
				details: `hostmaster=${value.hostmaster}; serial=${value.serial}; refresh=${value.refresh}; retry=${value.retry}; expire=${value.expire}; minttl=${value.minttl}`,
			}]),
			this.runLookup("dns", "SRV", () => this.resolver.resolveSrv(domain), errors, values => values.map(value => ({
				type: "SRV",
				value: `${value.name}:${value.port}`,
				details: `priority=${value.priority}; weight=${value.weight}`,
			}))),
			this.runLookup("dns", "NAPTR", () => this.resolver.resolveNaptr(domain), errors, values => values.map(value => ({
				type: "NAPTR",
				value: value.replacement,
				details: `order=${value.order}; preference=${value.preference}; flags=${value.flags}; service=${value.service}; regexp=${value.regexp}`,
			}))),
			includeAny
				? this.runLookup("dns", "ANY", () => this.resolver.resolveAny(domain), errors, values => values.map(value => formatAnyRecord(value)))
				: Promise.resolve([]),
		]);

		const dnsRecords = dedupeRecords(recordSets.flat());
		const reverseRecords = includeReverse ? await this.lookupReverseRecords(dnsRecords, errors) : [];
		const rdap = includeRdap ? await this.lookupRdap(domain, errors) : null;
		const filteredErrors = filterLookupErrors(
			errors,
			dnsRecords.length > 0 || reverseRecords.length > 0 || rdap !== null,
		);

		return {
			domain,
			queriedAt: new Date().toISOString(),
			records: sortRecords(dedupeRecords([...dnsRecords, ...reverseRecords])),
			rdap,
			errors: filteredErrors,
		};
	}

	private async runLookup<TResult>(
		source: DomainLookupSectionError["source"],
		scope: string,
		lookup: () => Promise<TResult>,
		errors: DomainLookupSectionError[],
		mapper: (value: TResult) => DomainLookupRecord[],
	): Promise<DomainLookupRecord[]> {
		try {
			const result = await withTimeout(lookup(), this.timeoutMs, `${source}:${scope}`);
			return mapper(result);
		} catch (error) {
			const formatted = formatLookupError(error);
			errors.push({
				source,
				scope,
				message: formatted.message,
				code: formatted.code,
			});
			return [];
		}
	}

	private async lookupReverseRecords(
		records: readonly DomainLookupRecord[],
		errors: DomainLookupSectionError[],
	): Promise<DomainLookupRecord[]> {
		const addresses = [...new Set(
			records
				.filter(record => record.type === "A" || record.type === "AAAA")
				.map(record => record.value),
		)];

		const reverseRecordSets = await Promise.all(addresses.map(async address => await this.runLookup(
			"reverse",
			`PTR:${address}`,
			async () => await this.resolver.reverse(address),
			errors,
			values => values.map(value => ({
				type: "PTR",
				value,
				details: address,
			})),
		)));

		return dedupeRecords(reverseRecordSets.flat());
	}

	private async lookupRdap(
		domain: string,
		errors: DomainLookupSectionError[],
	): Promise<DomainRdapInfo | null> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

		try {
			const response = await fetch(`${this.rdapBaseUrl}/domain/${encodeURIComponent(domain)}`, {
				headers: {
					accept: "application/rdap+json, application/json",
				},
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`RDAP request failed with HTTP ${response.status} ${response.statusText}`.trim());
			}

			const payload = await response.json();
			if (!isRecord(payload)) {
				throw new Error("RDAP response is not an object.");
			}

			const entities = Array.isArray(payload.entities)
				? payload.entities.filter(isRecord).map(entity => toRdapEntitySummary(entity))
				: [];

			const registrar = entities.find(entity => entity.roles.includes("registrar"));
			const nameservers = Array.isArray(payload.nameservers)
				? payload.nameservers
					.filter(isRecord)
					.map(item => {
						const value = typeof item.ldhName === "string"
							? item.ldhName
							: (typeof item.unicodeName === "string" ? item.unicodeName : undefined);
						return value?.trim() ?? "";
					})
					.filter(Boolean)
				: [];
			const events = Array.isArray(payload.events)
				? payload.events
					.filter(isRecord)
					.map(event => ({
						action: typeof event.eventAction === "string" ? event.eventAction : "unknown",
						timestamp: typeof event.eventDate === "string" ? event.eventDate : undefined,
						actor: typeof event.actor === "string" ? event.actor : undefined,
					}))
				: [];
			const notices = Array.isArray(payload.notices)
				? payload.notices
					.filter(isRecord)
					.map(notice => {
						const title = typeof notice.title === "string" ? notice.title : undefined;
						const descriptions = Array.isArray(notice.description)
							? notice.description.filter((entry): entry is string => typeof entry === "string")
							: [];
						return [title, ...descriptions].filter(Boolean).join(": ");
					})
					.filter(Boolean)
				: [];
			const status = Array.isArray(payload.status)
				? payload.status.filter((entry): entry is string => typeof entry === "string")
				: [];
			const secureDns = isRecord(payload.secureDNS)
				? [
					typeof payload.secureDNS.delegationSigned === "boolean"
						? `delegationSigned=${payload.secureDNS.delegationSigned}`
						: undefined,
					typeof payload.secureDNS.maxSigLife === "number"
						? `maxSigLife=${payload.secureDNS.maxSigLife}`
						: undefined,
				].filter(Boolean).join("; ")
				: undefined;

			return {
				handle: typeof payload.handle === "string" ? payload.handle : undefined,
				ldhName: typeof payload.ldhName === "string" ? payload.ldhName : undefined,
				unicodeName: typeof payload.unicodeName === "string" ? payload.unicodeName : undefined,
				status,
				nameservers,
				entities,
				registrar,
				events,
				notices,
				secureDns: secureDns || undefined,
				url: response.url,
			};
		} catch (error) {
			const formatted = formatLookupError(error);
			errors.push({
				source: "rdap",
				scope: domain,
				message: formatted.message,
				code: formatted.code,
			});
			return null;
		} finally {
			clearTimeout(timeoutId);
		}
	}
}