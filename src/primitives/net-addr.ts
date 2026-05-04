const DEFAULT_PROTOCOL = "http";

const DEFAULT_PORTS: Record<string, string> = {
	http: "80",
	https: "443",
};

const HTTPS_PORTS = new Set(["443", "8443", "9443"]);

function hasScheme(raw: string): boolean {
	return /^[a-z][a-z\d+.-]*:\/\//iu.test(raw);
}

function inferProtocol(raw: string): string {
	const portMatch = raw.match(/:(\d+)(?:$|[/?#])/u);
	if (!portMatch?.[1]) {
		return DEFAULT_PROTOCOL;
	}

	return HTTPS_PORTS.has(portMatch[1]) ? "https" : DEFAULT_PROTOCOL;
}

function normalizeInput(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		throw new TypeError("NetAddr input cannot be empty.");
	}

	if (hasScheme(trimmed)) {
		return trimmed;
	}

	const normalized = trimmed.replace(/^\/\//u, "");
	return `${inferProtocol(normalized)}://${normalized}`;
}

function resolvePort(url: URL): string {
	if (url.port.length > 0) {
		return url.port;
	}

	return DEFAULT_PORTS[url.protocol.slice(0, -1)] ?? "";
}

function formatCanonicalUrl(url: URL): string {
	const normalizedUrl = new URL(url.toString());
	const defaultPort = DEFAULT_PORTS[normalizedUrl.protocol.slice(0, -1)];
	if (normalizedUrl.port === defaultPort) {
		normalizedUrl.port = "";
	}

	const serialized = normalizedUrl.toString();
	if (normalizedUrl.pathname === "/" && normalizedUrl.search.length === 0 && normalizedUrl.hash.length === 0) {
		return serialized.replace(/\/$/u, "");
	}

	return serialized;
}

export type NetAddrInput = NetAddr | URL | string;

export class NetAddr {
	static from(input: NetAddrInput): NetAddr {
		return input instanceof NetAddr ? input : new NetAddr(input);
	}

	readonly raw: string;
	readonly hostname: string;
	readonly pathname: string;
	readonly port: string;
	readonly protocol: string;

	private readonly url: URL;

	constructor(input: NetAddrInput) {
		if (input instanceof NetAddr) {
			this.raw = input.raw;
			this.url = input.toUrlObject();
			this.protocol = input.protocol;
			this.hostname = input.hostname;
			this.port = input.port;
			this.pathname = input.pathname;
			return;
		}

		if (input instanceof URL) {
			this.raw = input.toString();
			this.url = new URL(input.toString());
		} else {
			this.raw = input;
			this.url = new URL(normalizeInput(input));
		}

		this.protocol = this.url.protocol.slice(0, -1);
		this.hostname = this.url.hostname;
		this.port = resolvePort(this.url);
		this.pathname = this.url.pathname;
	}

	toServerIpPort(): string {
		return this.port.length > 0 ? `${this.hostname}:${this.port}` : this.hostname;
	}

	toOrigin(): string {
		const originUrl = new URL(this.url.toString());
		originUrl.pathname = "/";
		originUrl.search = "";
		originUrl.hash = "";
		return formatCanonicalUrl(originUrl);
	}

	toUrl(): string {
		return formatCanonicalUrl(this.url);
	}

	toUrlObject(): URL {
		return new URL(this.url.toString());
	}

	toJSON(): string {
		return this.toUrl();
	}

	toString(): string {
		return this.toUrl();
	}
}