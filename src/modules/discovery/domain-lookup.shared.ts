import {
	DomainLookupKit,
	type DomainLookupKitOptions,
	type DomainLookupRequest,
	type DomainLookupResult,
} from "../../kits";

import { InvalidParamsError } from "../errors";

export type DomainLookupParams = {
	domain?: string;
	timeoutMs?: number;
	includeAny?: boolean;
	includeRdap?: boolean;
	includeReverse?: boolean;
	dnsServer?: string | string[];
	rdapBaseUrl?: string;
};

type DomainLookupRuntime = {
	getDomainLookupKit(): DomainLookupKit | null;
	attachKit<TKit>(kit: TKit, context: { reason?: string }): Promise<TKit>;
};

export type ResolvedDomainLookup = {
	domain: string;
	options: DomainLookupKitOptions;
	request: DomainLookupRequest;
};

function readRequiredDomain(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new InvalidParamsError("Param 'domain' is required. Example: domain=example.com");
	}

	return value.trim();
}

function readOptionalBoolean(value: unknown, paramName: string): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "boolean") {
		throw new InvalidParamsError(`Param '${paramName}' must be a boolean.`);
	}

	return value;
}

function readOptionalPositiveInteger(value: unknown, paramName: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new InvalidParamsError(`Param '${paramName}' must be a positive integer.`);
	}

	return value;
}

function readOptionalString(value: unknown, paramName: string): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "string" || value.trim().length === 0) {
		throw new InvalidParamsError(`Param '${paramName}' must be a non-empty string.`);
	}

	return value.trim();
}

function readDnsServers(value: unknown): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value === "string") {
		const servers = value.split(",").map(entry => entry.trim()).filter(Boolean);
		if (servers.length === 0) {
			throw new InvalidParamsError("Param 'dnsServer' must contain at least one resolver address.");
		}

		return servers;
	}

	if (Array.isArray(value)) {
		const servers = value.map(entry => {
			if (typeof entry !== "string" || entry.trim().length === 0) {
				throw new InvalidParamsError("Param 'dnsServer' array must only contain non-empty strings.");
			}

			return entry.trim();
		});
		if (servers.length === 0) {
			throw new InvalidParamsError("Param 'dnsServer' must contain at least one resolver address.");
		}

		return servers;
	}

	throw new InvalidParamsError("Param 'dnsServer' must be a string or an array of strings.");
}

export function resolveDomainLookupParams(params: DomainLookupParams): ResolvedDomainLookup {
	const domain = readRequiredDomain(params.domain);
	const timeoutMs = readOptionalPositiveInteger(params.timeoutMs, "timeoutMs");
	const includeAny = readOptionalBoolean(params.includeAny, "includeAny");
	const includeRdap = readOptionalBoolean(params.includeRdap, "includeRdap");
	const includeReverse = readOptionalBoolean(params.includeReverse, "includeReverse");
	const rdapBaseUrl = readOptionalString(params.rdapBaseUrl, "rdapBaseUrl");
	const dnsServers = readDnsServers(params.dnsServer);

	return {
		domain,
		options: {
			timeoutMs,
			rdapBaseUrl,
			rdapEnabled: includeRdap,
			dnsServers,
		},
		request: {
			includeAny,
			includeRdap,
			includeReverse,
		},
	};
}

export async function ensureDomainLookupKit(
	runtime: DomainLookupRuntime,
	options: DomainLookupKitOptions,
): Promise<DomainLookupKit> {
	let kit = runtime.getDomainLookupKit();
	if (!(kit instanceof DomainLookupKit) || !kit.matchesOptions(options)) {
		kit = await runtime.attachKit(new DomainLookupKit(options), {
			reason: "module:discovery/domain-lookup",
		});
	}

	return kit;
}

export async function executeDomainLookup(
	runtime: DomainLookupRuntime,
	params: DomainLookupParams,
): Promise<{ resolved: ResolvedDomainLookup; kit: DomainLookupKit; result: DomainLookupResult }> {
	const resolved = resolveDomainLookupParams(params);
	const kit = await ensureDomainLookupKit(runtime, resolved.options);
	const result = await kit.lookupDomain(resolved.domain, resolved.request);

	return { resolved, kit, result };
}