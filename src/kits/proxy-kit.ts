import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { Kit, type KitLifecycleContext } from "./kit";

export const PROXY_KIT_ID = "proxy";

export type ProxyType = "HTTP" | "HTTPS" | "SOCKS4" | "SOCKS4A" | "SOCKS5" | "SOCKS5H";

export type ProxyProfile = {
	id: string;
	name: string;
	host: string;
	port: number;
	username?: string;
	password?: string;
	type: ProxyType;
};

export type ProxyTestResult = {
	latencyMs: number;
	ip: string;
	country?: string;
	error?: string;
};

export class ProxyKit extends Kit {
	private proxies: ProxyProfile[] = [];
	private proxiesPath: string;

	constructor() {
		super({
			id: PROXY_KIT_ID,
			name: "Proxy Kit",
			description: "Manage and test proxy servers",
		});
		this.proxiesPath = path.join(process.cwd(), ".iscan", "proxies.json");
	}

	protected override async onStart(_context: KitLifecycleContext): Promise<void> {
		try {
			await fs.mkdir(path.dirname(this.proxiesPath), { recursive: true });
			const data = await fs.readFile(this.proxiesPath, "utf-8");
			this.proxies = JSON.parse(data);
		} catch {
			this.proxies = [];
		}
	}

	protected override async onStop(_context: KitLifecycleContext): Promise<void> {
		// No special cleanup needed for now
	}

	private async persistProxies(): Promise<void> {
		await fs.writeFile(this.proxiesPath, JSON.stringify(this.proxies, null, 2));
	}

	getProxies(): ProxyProfile[] {
		return this.proxies.map(proxy => ({ ...proxy }));
	}

	async saveProxy(proxy: ProxyProfile): Promise<void> {
		const index = this.proxies.findIndex(p => p.id === proxy.id);
		if (index >= 0) {
			this.proxies[index] = { ...proxy };
		} else {
			this.proxies.push({ ...proxy });
		}
		await this.persistProxies();
	}

	async replaceProxies(proxies: ProxyProfile[]): Promise<void> {
		this.proxies = proxies.map(proxy => ({ ...proxy }));
		await this.persistProxies();
	}

	async deleteProxy(id: string): Promise<void> {
		this.proxies = this.proxies.filter(p => p.id !== id);
		await this.persistProxies();
	}

	async testProxy(id: string): Promise<ProxyTestResult> {
		const proxy = this.proxies.find(p => p.id === id);
		if (!proxy) throw new Error(`Proxy ${id} not found`);

		const start = Date.now();
		try {
			const authPrefix = proxy.username
				? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || "")}@`
				: "";
			let httpAgent: unknown;
			let httpsAgent: unknown;

			if (proxy.type.startsWith("SOCKS")) {
				const { SocksProxyAgent } = await import("socks-proxy-agent");
				const protocol = proxy.type.toLowerCase();
				const agent = new SocksProxyAgent(`${protocol}://${authPrefix}${proxy.host}:${proxy.port}`);
				httpAgent = agent;
				httpsAgent = agent;
			} else {
				const { HttpProxyAgent } = await import("http-proxy-agent");
				const { HttpsProxyAgent } = await import("https-proxy-agent");
				const protocol = proxy.type === "HTTPS" ? "https" : "http";
				const proxyUrl = `${protocol}://${authPrefix}${proxy.host}:${proxy.port}`;
				httpAgent = new HttpProxyAgent(proxyUrl);
				httpsAgent = new HttpsProxyAgent(proxyUrl);
			}

			const response = await axios.get("https://api.ipify.org?format=json", {
				httpAgent,
				httpsAgent,
				timeout: 10000,
				// Ensure axios doesn't use its internal proxy logic which conflicts with agents
				proxy: false 
			});

			return {
				latencyMs: Date.now() - start,
				ip: response.data.ip,
				country: "Checked"
			};
		} catch (err: any) {
			return {
				latencyMs: Date.now() - start,
				ip: "Error",
				error: err.message
			};
		}
	}
}
