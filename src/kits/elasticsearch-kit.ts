import { Buffer } from "node:buffer";

import type { AxiosRequestConfig, AxiosResponse } from "axios";

import { $axios } from "../axios";

import { Kit, type KitInfo, type KitLifecycleContext } from "./kit";

export const ELASTICSEARCH_KIT_ID = "elasticsearch";

const ELASTICSEARCH_KIT_INFO: KitInfo = {
	id: ELASTICSEARCH_KIT_ID,
	name: "ElasticSearchKit",
	category: "service",
	description: "Reusable Elasticsearch client for internal modules and standalone scripts.",
	tags: ["elasticsearch", "search", "http"],
};

export type ElasticSearchAuth =
	| {
		type: "basic";
		username: string;
		password: string;
	}
	| {
		type: "api-key";
		apiKey: string;
	}
	| {
		type: "bearer";
		token: string;
	};

export type ElasticSearchKitOptions = {
	node: string;
	defaultIndex?: string | readonly string[];
	auth?: ElasticSearchAuth;
	headers?: Record<string, string>;
	requestTimeoutMs?: number;
};

export type ElasticSearchClusterInfo = {
	name?: string;
	cluster_name?: string;
	cluster_uuid?: string;
	tagline?: string;
	version?: Record<string, unknown>;
	[key: string]: unknown;
};

export type ElasticSearchClusterHealth = {
	cluster_name?: string;
	status?: string;
	timed_out?: boolean;
	number_of_nodes?: number;
	number_of_data_nodes?: number;
	active_primary_shards?: number;
	active_shards?: number;
	unassigned_shards?: number;
	initializing_shards?: number;
	relocating_shards?: number;
	[key: string]: unknown;
};

export type ElasticSearchSearchBody = Record<string, unknown>;

export type ElasticSearchSearchHit<TDocument> = {
	_index: string;
	_id: string;
	_score?: number | null;
	_source?: TDocument;
	fields?: Record<string, unknown>;
	[key: string]: unknown;
};

export type ElasticSearchSearchResponse<TDocument = Record<string, unknown>> = {
	took?: number;
	timed_out?: boolean;
	_shards?: Record<string, unknown>;
	hits: {
		total?:
			| number
			| {
				value: number;
				relation: string;
			};
		max_score?: number | null;
		hits: ElasticSearchSearchHit<TDocument>[];
	};
	aggregations?: Record<string, unknown>;
	[key: string]: unknown;
};

export type ElasticSearchRequestOptions<TBody = unknown> = Omit<AxiosRequestConfig<TBody>, "baseURL" | "headers"> & {
	headers?: Record<string, string>;
};

function normalizeNodeUrl(node: string): string {
	const normalized = node.trim().replace(/\/+$/u, "");
	if (normalized.length === 0) {
		throw new Error("ElasticSearch node URL must not be empty.");
	}

	return normalized;
}

function normalizeIndexPath(index: string | readonly string[] | undefined): string {
	if (!index) {
		return "";
	}

	const parts = (Array.isArray(index) ? index : [index])
		.map(value => value.trim())
		.filter(value => value.length > 0);

	return parts.join(",");
}

function resolveAuthHeaders(auth: ElasticSearchAuth | undefined): Record<string, string> {
	if (!auth) {
		return {};
	}

	switch (auth.type) {
		case "basic":
			return {
				Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`,
			};
		case "api-key":
			return {
				Authorization: `ApiKey ${auth.apiKey}`,
			};
		case "bearer":
			return {
				Authorization: `Bearer ${auth.token}`,
			};
		default:
			return {};
	}
}

export class ElasticSearchKit extends Kit {
	private readonly node: string;
	private readonly defaultIndex: string | readonly string[] | undefined;
	private readonly auth: ElasticSearchAuth | undefined;
	private readonly defaultHeaders: Record<string, string>;
	private readonly requestTimeoutMs: number | undefined;
	private clusterInfo: ElasticSearchClusterInfo | null = null;

	constructor(options: ElasticSearchKitOptions) {
		super(ELASTICSEARCH_KIT_INFO);
		this.node = normalizeNodeUrl(options.node);
		this.defaultIndex = options.defaultIndex;
		this.auth = options.auth;
		this.defaultHeaders = { ...(options.headers ?? {}) };
		this.requestTimeoutMs = options.requestTimeoutMs;
	}

	getNode(): string {
		return this.node;
	}

	getDefaultIndex(): string | readonly string[] | undefined {
		return this.defaultIndex;
	}

	getConnectionSummary(): string {
		const defaultIndex = normalizeIndexPath(this.defaultIndex);
		return defaultIndex.length > 0 ? `${this.node} • index ${defaultIndex}` : this.node;
	}

	getClusterInfo(): ElasticSearchClusterInfo | null {
		return this.clusterInfo;
	}

	isConnected(): boolean {
		return this.clusterInfo !== null;
	}

	override async onStart(_context: KitLifecycleContext): Promise<void> {
		await this.connect();
	}

	override async onStop(_context: KitLifecycleContext): Promise<void> {
		await this.disconnect();
	}

	async connect(): Promise<ElasticSearchClusterInfo> {
		const info = await this.request<ElasticSearchClusterInfo>({
			method: "GET",
			url: "/",
		});
		this.clusterInfo = info;
		return info;
	}

	async disconnect(): Promise<void> {
		this.clusterInfo = null;
	}

	async ping(): Promise<boolean> {
		try {
			await $axios.request({
				method: "HEAD",
				baseURL: this.node,
				url: "/",
				headers: this.createHeaders(),
				timeout: this.requestTimeoutMs,
			});
			return true;
		} catch {
			return false;
		}
	}

	async getClusterHealth(level: "cluster" | "indices" | "shards" = "cluster"): Promise<ElasticSearchClusterHealth> {
		return await this.request<ElasticSearchClusterHealth>({
			method: "GET",
			url: "/_cluster/health",
			params: { level },
		});
	}

	async search<TDocument = Record<string, unknown>>(
		body: ElasticSearchSearchBody,
		options: {
			index?: string | readonly string[];
			signal?: AbortSignal;
		} = {},
	): Promise<ElasticSearchSearchResponse<TDocument>> {
		const path = normalizeIndexPath(options.index ?? this.defaultIndex);
		const url = path.length > 0 ? `/${path}/_search` : "/_search";

		return await this.request<ElasticSearchSearchResponse<TDocument>, ElasticSearchSearchBody>({
			method: "POST",
			url,
			data: body,
			signal: options.signal,
		});
	}

	async request<TResponse, TBody = unknown>(config: ElasticSearchRequestOptions<TBody>): Promise<TResponse> {
		const response = await $axios.request<TResponse, AxiosResponse<TResponse>, TBody>({
			...config,
			baseURL: this.node,
			headers: this.createHeaders(config.headers),
			timeout: config.timeout ?? this.requestTimeoutMs,
		});

		return response.data;
	}

	private createHeaders(headers: Record<string, string> = {}): Record<string, string> {
		return {
			Accept: "application/json",
			...this.defaultHeaders,
			...resolveAuthHeaders(this.auth),
			...headers,
		};
	}
}