import { $config, type ResolvedUaServiceConfig, type ResolvedUaSourceConfig } from "../config";
import { Kit, type KitInfo } from "./kit";
import {
	$storageKit,
	type MicrolinkUaSnapshotRow,
	type MicrolinkUaSnapshotStatus as PersistedMicrolinkUaSnapshotStatus,
	type UaSourceRow,
} from "./storage-kit";
import { UA_MICROLINK_SOURCE_ID, UaKit } from "./ua-kit";

export const MICROLINK_UA_KIT_ID = "microlink-ua";

const MICROLINK_UA_SOURCE_URL = "https://microlink.io/user-agents.json";
const MICROLINK_UA_STALE_AFTER_MS = 1000 * 60 * 60 * 4;
const MICROLINK_UA_REQUEST_TIMEOUT_MS = 15000;

const MICROLINK_UA_KIT_INFO: KitInfo = {
	id: MICROLINK_UA_KIT_ID,
	name: "MicrolinkUaKit",
	category: "service",
	description: "Cached Microlink user-agent feed client for browser profile editing and offline reuse.",
	tags: ["microlink", "user-agent", "http", "cache"],
};

export type MicrolinkUaPayload = {
	ai: string[];
	crawler: string[];
	updatedAt: number | null;
	user: string[];
};

export type MicrolinkUaStatus = {
	aiCount: number;
	crawlerCount: number;
	errorMessage: string | null;
	fetchStatus: "empty" | PersistedMicrolinkUaSnapshotStatus;
	fetchedAt: string | null;
	hasCachedPayload: boolean;
	isStale: boolean;
	microlinkUpdatedAt: number | null;
	sourceUrl: string;
	userAgentCount: number;
};

export type MicrolinkUaKitOptions = {
	requestTimeoutMs?: number;
	sourceUrl?: string;
	staleAfterMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStringList(value: readonly string[]): string[] {
	const items: string[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		const normalized = entry.trim();
		if (normalized.length === 0 || seen.has(normalized)) {
			continue;
		}

		seen.add(normalized);
		items.push(normalized);
	}

	return items;
}

function normalizeUpdatedAt(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return null;
	}

	return Math.trunc(value);
}

function resolveMicrolinkSource(serviceConfig: ResolvedUaServiceConfig, sourceUrlOverride?: string): ResolvedUaSourceConfig {
	const configuredSource = serviceConfig.sources.find((source) => source.id === UA_MICROLINK_SOURCE_ID);
	return {
		categories: configuredSource?.categories.length ? [...configuredSource.categories] : ["user", "crawler", "ai"],
		enabled: true,
		id: configuredSource?.id ?? UA_MICROLINK_SOURCE_ID,
		kind: configuredSource?.kind ?? "microlink-json",
		recordKinds: configuredSource?.recordKinds.includes("exact")
			? [...configuredSource.recordKinds]
			: ["exact"],
		url: sourceUrlOverride?.trim() || configuredSource?.url || MICROLINK_UA_SOURCE_URL,
	};
}

function createMicrolinkCompatConfig(
	serviceConfig: ResolvedUaServiceConfig,
	sourceUrlOverride: string | undefined,
	staleAfterMs: number,
): ResolvedUaServiceConfig {
	return {
		refreshIntervalMs: serviceConfig.refreshIntervalMs,
		refreshOnEmpty: serviceConfig.refreshOnEmpty,
		sources: [resolveMicrolinkSource(serviceConfig, sourceUrlOverride)],
		staleAfterMs,
	};
}

function parseUpdatedAtFromMetadata(metadataJson: string | null): number | null {
	if (!metadataJson) {
		return null;
	}

	try {
		const parsed = JSON.parse(metadataJson);
		if (!isRecord(parsed)) {
			return null;
		}

		return normalizeUpdatedAt(parsed.updatedAt);
	} catch {
		return null;
	}
}

export class MicrolinkUaKit extends Kit {
	private readonly requestTimeoutMs: number;
	private readonly sourceUrl: string;
	private readonly staleAfterMs: number;
	private readonly uaKit: UaKit;

	constructor(options: MicrolinkUaKitOptions = {}) {
		super(MICROLINK_UA_KIT_INFO);
		const serviceConfig = $config.services.ua;
		const resolvedSource = resolveMicrolinkSource(serviceConfig, options.sourceUrl);
		this.requestTimeoutMs = options.requestTimeoutMs ?? MICROLINK_UA_REQUEST_TIMEOUT_MS;
		this.sourceUrl = resolvedSource.url;
		this.staleAfterMs = options.staleAfterMs ?? serviceConfig.staleAfterMs ?? MICROLINK_UA_STALE_AFTER_MS;
		this.uaKit = new UaKit({
			config: createMicrolinkCompatConfig(serviceConfig, this.sourceUrl, this.staleAfterMs),
			requestTimeoutMs: this.requestTimeoutMs,
		});
	}

	getSourceUrl(): string {
		return this.sourceUrl;
	}

	getStaleAfterMs(): number {
		return this.staleAfterMs;
	}

	private getCachedSourceRow(): UaSourceRow | null {
		return $storageKit.selectUaSources().find((row) => row.source_id === UA_MICROLINK_SOURCE_ID) ?? null;
	}

	getCachedSnapshot(): MicrolinkUaSnapshotRow | null {
		const sourceRow = this.getCachedSourceRow();
		if (!sourceRow?.fetch_status || !sourceRow.fetched_at) {
			return null;
		}

		const payload = this.getCachedPayload();
		return {
			error_message: sourceRow.error_message,
			fetch_status: sourceRow.fetch_status,
			fetched_at: sourceRow.fetched_at,
			microlink_updated_at: parseUpdatedAtFromMetadata(sourceRow.metadata_json),
			payload_json: payload ? JSON.stringify(payload) : null,
			snapshot_key: UA_MICROLINK_SOURCE_ID,
			source_url: sourceRow.source_url,
		};
	}

	getCachedPayload(): MicrolinkUaPayload | null {
		const sourceRow = this.getCachedSourceRow();
		const exactAgentRows = $storageKit.selectUaExactAgents().filter((row) => row.source_id === UA_MICROLINK_SOURCE_ID);
		if (!sourceRow && exactAgentRows.length === 0) {
			return null;
		}

		const payload = {
			ai: normalizeStringList(exactAgentRows.filter((row) => row.category === "ai").map((row) => row.user_agent)),
			crawler: normalizeStringList(exactAgentRows.filter((row) => row.category === "crawler").map((row) => row.user_agent)),
			updatedAt: parseUpdatedAtFromMetadata(sourceRow?.metadata_json ?? null),
			user: normalizeStringList(exactAgentRows.filter((row) => row.category === "user").map((row) => row.user_agent)),
		};

		return payload.ai.length > 0 || payload.crawler.length > 0 || payload.user.length > 0
			? payload
			: null;
	}

	async listUserAgents(): Promise<string[]> {
		const cachedPayload = this.getCachedPayload();
		if (cachedPayload) {
			return cachedPayload.user;
		}

		const refreshedStatus = await this.refresh();
		if (!refreshedStatus.hasCachedPayload) {
			return [];
		}

		return this.getCachedPayload()?.user ?? [];
	}

	async refresh(): Promise<MicrolinkUaStatus> {
		await this.uaKit.refresh([UA_MICROLINK_SOURCE_ID]);
		return await this.getStatus();
	}

	async getStatus(): Promise<MicrolinkUaStatus> {
		const snapshot = this.getCachedSnapshot();
		const payload = this.getCachedPayload();
		const fetchedAt = snapshot?.fetched_at ?? null;
		const isStale = fetchedAt
			? (Date.now() - Date.parse(fetchedAt)) > this.staleAfterMs
			: true;

		return {
			aiCount: payload?.ai.length ?? 0,
			crawlerCount: payload?.crawler.length ?? 0,
			errorMessage: snapshot?.error_message ?? null,
			fetchStatus: snapshot?.fetch_status ?? "empty",
			fetchedAt,
			hasCachedPayload: Boolean(payload),
			isStale,
			microlinkUpdatedAt: payload?.updatedAt ?? snapshot?.microlink_updated_at ?? null,
			sourceUrl: snapshot?.source_url ?? this.sourceUrl,
			userAgentCount: payload?.user.length ?? 0,
		};
	}
}