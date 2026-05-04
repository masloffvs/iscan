import {
	DomainLookupKit,
	type DomainLookupResult,
	type DomainRdapEntitySummary,
	type DomainRdapEvent,
	type DomainRdapInfo,
} from "../../kits";
	
import { createTableEntity, createTextEntity, type OutputEntity } from "../../primitives";
import { defineExecutor, defineModule, type ModuleConsoleParam } from "../module";
import { executeDomainLookup } from "./domain-lookup.shared";
import type { DomainLookupParams } from "./domain-lookup.shared";

const DOMAIN_LOOKUP_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "domain",
		detail: "Domain name to resolve and inspect.",
		valueType: "string",
		example: "domain=example.com",
		required: true,
	},
	{
		name: "timeoutMs",
		detail: "DNS and RDAP timeout in milliseconds.",
		valueType: "number",
		example: "timeoutMs=10000",
	},
	{
		name: "includeAny",
		detail: "Request ANY-style records when supported by the resolver.",
		valueType: "boolean",
		values: ["true", "false"],
		example: "includeAny=true",
	},
	{
		name: "includeRdap",
		detail: "Enable or disable RDAP lookup for registration metadata.",
		valueType: "boolean",
		values: ["true", "false"],
		example: "includeRdap=true",
	},
	{
		name: "includeReverse",
		detail: "Include reverse lookup for resolved IP addresses.",
		valueType: "boolean",
		values: ["true", "false"],
		example: "includeReverse=true",
	},
	{
		name: "dnsServer",
		detail: "Comma-separated resolver list or JSON array of resolver addresses.",
		valueType: "string[]",
		example: "dnsServer=1.1.1.1,8.8.8.8",
	},
	{
		name: "rdapBaseUrl",
		detail: "Override RDAP base URL.",
		valueType: "string",
		example: "rdapBaseUrl=https://rdap.org/domain/",
	},
];

function formatList(values: readonly string[]): string {
	return values.length > 0 ? values.join(", ") : "none";
}

function buildSummaryEntity(result: DomainLookupResult, kit: DomainLookupKit): OutputEntity {
	const resolverText = kit.getDnsServers().length > 0 ? formatList(kit.getDnsServers()) : "system default";

	return createTextEntity(
		[
			"Domain lookup",
			`Domain: ${result.domain}`,
			`Queried at: ${result.queriedAt}`,
			`Records: ${result.records.length}`,
			`Failures: ${result.errors.length}`,
			`RDAP: ${result.rdap ? "available" : (kit.isRdapEnabled() ? "unavailable" : "disabled")}`,
			`Resolvers: ${resolverText}`,
			`Timeout: ${kit.getTimeoutMs()} ms`,
		],
		{ tone: "info" },
	);
}

function buildRecordsEntity(result: DomainLookupResult): OutputEntity {
	if (result.records.length === 0) {
		return createTextEntity("No DNS records were resolved.", { tone: "muted" });
	}

	return createTableEntity(
		[
			{ key: "type", header: "Type", maxWidth: 10 },
			{ key: "value", header: "Value", maxWidth: 44 },
			{ key: "details", header: "Details", maxWidth: 72 },
		],
		result.records.map(record => ({
			type: record.type,
			value: record.value,
			details: record.details ?? "",
		})),
		{ title: "DNS records" },
	);
}

function buildRdapSummaryEntity(rdap: DomainRdapInfo): OutputEntity {
	return createTextEntity(
		[
			"RDAP",
			`Handle: ${rdap.handle ?? "unknown"}`,
			`LDH: ${rdap.ldhName ?? "unknown"}`,
			`Unicode: ${rdap.unicodeName ?? "unknown"}`,
			`Statuses: ${formatList(rdap.status)}`,
			`Registrar: ${rdap.registrar?.name ?? rdap.registrar?.handle ?? "unknown"}`,
			`Nameservers: ${formatList(rdap.nameservers)}`,
			`Secure DNS: ${rdap.secureDns ?? "unknown"}`,
			`Endpoint: ${rdap.url ?? "unknown"}`,
		],
		{ tone: "info" },
	);
}

function buildRdapEntitiesEntity(entities: readonly DomainRdapEntitySummary[]): OutputEntity | null {
	if (entities.length === 0) {
		return null;
	}

	return createTableEntity(
		[
			{ key: "roles", header: "Roles", maxWidth: 24 },
			{ key: "name", header: "Name", maxWidth: 30 },
			{ key: "handle", header: "Handle", maxWidth: 20 },
			{ key: "email", header: "Email", maxWidth: 32 },
		],
		entities.map(entity => ({
			roles: formatList(entity.roles),
			name: entity.name ?? "",
			handle: entity.handle ?? "",
			email: entity.email ?? "",
		})),
		{ title: "RDAP entities" },
	);
}

function buildRdapEventsEntity(events: readonly DomainRdapEvent[]): OutputEntity | null {
	if (events.length === 0) {
		return null;
	}

	return createTableEntity(
		[
			{ key: "action", header: "Action", maxWidth: 24 },
			{ key: "timestamp", header: "Timestamp", maxWidth: 32 },
			{ key: "actor", header: "Actor", maxWidth: 24 },
		],
		events.map(event => ({
			action: event.action,
			timestamp: event.timestamp ?? "",
			actor: event.actor ?? "",
		})),
		{ title: "RDAP events" },
	);
}

function buildRdapNoticesEntity(notices: readonly string[]): OutputEntity | null {
	if (notices.length === 0) {
		return null;
	}

	return createTableEntity(
		[
			{ key: "notice", header: "Notice", maxWidth: 100 },
		],
		notices.map(notice => ({ notice })),
		{ title: "RDAP notices" },
	);
}

function buildErrorsEntity(result: DomainLookupResult): OutputEntity | null {
	if (result.errors.length === 0) {
		return null;
	}

	return createTableEntity(
		[
			{ key: "source", header: "Source", maxWidth: 12 },
			{ key: "scope", header: "Scope", maxWidth: 24 },
			{ key: "code", header: "Code", maxWidth: 16 },
			{ key: "message", header: "Message", maxWidth: 72 },
		],
		result.errors.map(error => ({
			source: error.source,
			scope: error.scope,
			code: error.code ?? "",
			message: error.message,
		})),
		{ title: "Lookup failures" },
	);
}

function renderDomainLookup(result: DomainLookupResult, kit: DomainLookupKit): OutputEntity[] {
	const entities: OutputEntity[] = [
		buildSummaryEntity(result, kit),
		buildRecordsEntity(result),
	];

	if (result.rdap) {
		entities.push(buildRdapSummaryEntity(result.rdap));
		const rdapEntities = buildRdapEntitiesEntity(result.rdap.entities);
		if (rdapEntities) {
			entities.push(rdapEntities);
		}
		const rdapEvents = buildRdapEventsEntity(result.rdap.events);
		if (rdapEvents) {
			entities.push(rdapEvents);
		}
		const rdapNotices = buildRdapNoticesEntity(result.rdap.notices);
		if (rdapNotices) {
			entities.push(rdapNotices);
		}
	}

	const errorsEntity = buildErrorsEntity(result);
	if (errorsEntity) {
		entities.push(errorsEntity);
	}

	return entities;
}

export const domainLookupExecutor = defineExecutor<DomainLookupParams>(async ({ params, runtime }) => {
	const { result, kit } = await executeDomainLookup(runtime, params);
	return renderDomainLookup(result, kit);
});

export const domainLookupModule = defineModule({
	id: "discovery/domain-lookup",
	category: "discovery",
	description: "Collect DNS, reverse DNS, and RDAP information for a domain",
	consoleParams: DOMAIN_LOOKUP_CONSOLE_PARAMS,
	executor: domainLookupExecutor,
}).useDefault("domain");