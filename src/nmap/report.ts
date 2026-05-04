import { load } from "cheerio";

import { InvalidParamsError } from "../modules/errors";

export type NmapReportScript = {
	id: string;
	output?: string;
};

export type NmapReportAddress = {
	addr: string;
	addrType?: string;
	vendor?: string;
};

export type NmapReportService = {
	confidence?: number;
	extraInfo?: string;
	method?: string;
	name?: string;
	product?: string;
	tunnel?: string;
	version?: string;
};

export type NmapReportPort = {
	port: number;
	protocol: string;
	reason?: string;
	scripts: NmapReportScript[];
	service?: NmapReportService;
	state: string;
};

export type NmapReportHost = {
	addresses: NmapReportAddress[];
	hostnames: string[];
	osMatches: string[];
	ports: NmapReportPort[];
	scripts: NmapReportScript[];
	status: string;
	statusReason?: string;
};

export type NmapReportRunStats = {
	down: number;
	elapsedSeconds?: number;
	exit?: string;
	summary?: string;
	total: number;
	up: number;
};

export type NmapReport = {
	args?: string;
	hosts: NmapReportHost[];
	runStats: NmapReportRunStats | null;
	scanner?: string;
	startEpoch?: number;
	startText?: string;
	version?: string;
	xmlOutputVersion?: string;
};

function readAttr(element: ReturnType<typeof load>["prototype"], name: string): string | undefined {
	const value = element.attr(name);
	if (typeof value !== "string") {
		return undefined;
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}

	const numericValue = Number.parseInt(value, 10);
	return Number.isFinite(numericValue) ? numericValue : undefined;
}

function parseOptionalFloat(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}

	const numericValue = Number.parseFloat(value);
	return Number.isFinite(numericValue) ? numericValue : undefined;
}

function parseRequiredString(value: unknown, fieldName: string): string {
	if (typeof value !== "string") {
		throw new InvalidParamsError(`${fieldName} must be a string.`);
	}

	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new InvalidParamsError(`${fieldName} must be a non-empty string.`);
	}

	return normalized;
}

function parseNmapScripts(
	$: ReturnType<typeof load>,
	root: ReturnType<typeof load>["prototype"],
): NmapReportScript[] {
	return root.children("script").toArray().flatMap((scriptNode) => {
		const script = $(scriptNode);
		const id = readAttr(script, "id");
		if (!id) {
			return [];
		}

		return [{
			id,
			...(readAttr(script, "output") ? { output: readAttr(script, "output") } : {}),
		}];
	});
}

export function parseNmapXmlReport(xml: string): NmapReport {
	const normalizedXml = parseRequiredString(xml, "xml");
	const $ = load(normalizedXml, { xml: true });
	const reportNode = $("nmaprun").first();
	if (reportNode.length === 0) {
		throw new InvalidParamsError("Nmap XML is missing the <nmaprun> root element.");
	}

	const hosts = reportNode.children("host").toArray().map((hostNode) => {
		const host = $(hostNode);
		const statusNode = host.children("status").first();
		const status = readAttr(statusNode, "state") ?? "unknown";
		const hostnames = host
			.children("hostnames")
			.children("hostname")
			.toArray()
			.flatMap((hostnameNode) => {
				const hostname = $(hostnameNode);
				const name = readAttr(hostname, "name");
				return name ? [name] : [];
			});

		const addresses = host.children("address").toArray().flatMap((addressNode) => {
			const address = $(addressNode);
			const addr = readAttr(address, "addr");
			if (!addr) {
				return [];
			}

			return [{
				addr,
				...(readAttr(address, "addrtype") ? { addrType: readAttr(address, "addrtype") } : {}),
				...(readAttr(address, "vendor") ? { vendor: readAttr(address, "vendor") } : {}),
			}];
		});

		const ports = host.children("ports").children("port").toArray().flatMap((portNode) => {
			const port = $(portNode);
			const protocol = readAttr(port, "protocol");
			const portNumber = parseOptionalInteger(readAttr(port, "portid"));
			if (!protocol || portNumber === undefined) {
				return [];
			}

			const stateNode = port.children("state").first();
			const serviceNode = port.children("service").first();
			const serviceName = readAttr(serviceNode, "name");
			const serviceProduct = readAttr(serviceNode, "product");
			const serviceVersion = readAttr(serviceNode, "version");
			const serviceExtraInfo = readAttr(serviceNode, "extrainfo");
			const serviceTunnel = readAttr(serviceNode, "tunnel");
			const serviceMethod = readAttr(serviceNode, "method");
			const serviceConfidence = parseOptionalInteger(readAttr(serviceNode, "conf"));

			return [{
				port: portNumber,
				protocol,
				state: readAttr(stateNode, "state") ?? "unknown",
				...(readAttr(stateNode, "reason") ? { reason: readAttr(stateNode, "reason") } : {}),
				scripts: parseNmapScripts($, port),
				...((serviceName || serviceProduct || serviceVersion || serviceExtraInfo || serviceTunnel || serviceMethod || serviceConfidence !== undefined)
					? {
						service: {
							...(serviceName ? { name: serviceName } : {}),
							...(serviceProduct ? { product: serviceProduct } : {}),
							...(serviceVersion ? { version: serviceVersion } : {}),
							...(serviceExtraInfo ? { extraInfo: serviceExtraInfo } : {}),
							...(serviceTunnel ? { tunnel: serviceTunnel } : {}),
							...(serviceMethod ? { method: serviceMethod } : {}),
							...(serviceConfidence !== undefined ? { confidence: serviceConfidence } : {}),
						},
					}
					: {}),
			}];
		});

		const osMatches = host.children("os").children("osmatch").toArray().flatMap((osMatchNode) => {
			const osMatch = $(osMatchNode);
			const name = readAttr(osMatch, "name");
			return name ? [name] : [];
		});

		return {
			addresses,
			hostnames,
			osMatches,
			ports,
			scripts: parseNmapScripts($, host.children("hostscript").first()),
			status,
			...(readAttr(statusNode, "reason") ? { statusReason: readAttr(statusNode, "reason") } : {}),
		};
	});

	const finishedNode = reportNode.children("runstats").children("finished").first();
	const hostsNode = reportNode.children("runstats").children("hosts").first();
	const up = parseOptionalInteger(readAttr(hostsNode, "up"));
	const down = parseOptionalInteger(readAttr(hostsNode, "down"));
	const total = parseOptionalInteger(readAttr(hostsNode, "total"));

	return {
		...(readAttr(reportNode, "scanner") ? { scanner: readAttr(reportNode, "scanner") } : {}),
		...(readAttr(reportNode, "args") ? { args: readAttr(reportNode, "args") } : {}),
		...(parseOptionalInteger(readAttr(reportNode, "start")) !== undefined ? { startEpoch: parseOptionalInteger(readAttr(reportNode, "start")) } : {}),
		...(readAttr(reportNode, "startstr") ? { startText: readAttr(reportNode, "startstr") } : {}),
		...(readAttr(reportNode, "version") ? { version: readAttr(reportNode, "version") } : {}),
		...(readAttr(reportNode, "xmloutputversion") ? { xmlOutputVersion: readAttr(reportNode, "xmloutputversion") } : {}),
		hosts,
		runStats: up !== undefined && down !== undefined && total !== undefined
			? {
				down,
				...(parseOptionalFloat(readAttr(finishedNode, "elapsed")) !== undefined ? { elapsedSeconds: parseOptionalFloat(readAttr(finishedNode, "elapsed")) } : {}),
				...(readAttr(finishedNode, "exit") ? { exit: readAttr(finishedNode, "exit") } : {}),
				...(readAttr(finishedNode, "summary") ? { summary: readAttr(finishedNode, "summary") } : {}),
				total,
				up,
			}
			: null,
	};
}