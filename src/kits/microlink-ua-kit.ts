import type { AxiosError } from "axios";

import { $axios } from "../axios";

import { Kit, type KitInfo } from "./kit";
import {
	$storageKit,
	type MicrolinkUaSnapshotRow,
	type MicrolinkUaSnapshotStatus as PersistedMicrolinkUaSnapshotStatus,
} from "./storage-kit";

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

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const items: string[] = [];
	const seen = new Set<string>();
 for (const entry of value) {
		if (typeof entry !== "string") {
			continue;
		}

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

function normalizeMicrolinkUaPayload(value: unknown): MicrolinkUaPayload {
	if (!isRecord(value)) {
		throw new Error("Microlink UA payload must be an object.");
	}

	return {
		ai: normalizeStringList(value.ai),
		crawler: normalizeStringList(value.crawler),
		updatedAt: normalizeUpdatedAt(value.updatedAt),
		user: normalizeStringList(value.user),
	};
}

function parseMicrolinkUaPayload(payloadJson: string | null): MicrolinkUaPayload | null {
	if (!payloadJson) {
		return null;
	}

	try {
		return normalizeMicrolinkUaPayload(JSON.parse(payloadJson));
	} catch {
		return null;
	}
}

function formatRequestError(error: unknown): string {
	if (isRecord(error) && typeof error.message === "string") {
		return error.message;
	}

	const axiosError = error as AxiosError | undefined;
	if (axiosError?.response?.status) {
		return `Microlink request failed with status ${axiosError.response.status}.`;
	}

	return String(error);
}

export class MicrolinkUaKit extends Kit {
	private readonly requestTimeoutMs: number;
	private readonly sourceUrl: string;
	private readonly staleAfterMs: number;

	constructor(options: MicrolinkUaKitOptions = {}) {
		super(MICROLINK_UA_KIT_INFO);
		this.requestTimeoutMs = options.requestTimeoutMs ?? MICROLINK_UA_REQUEST_TIMEOUT_MS;
		this.sourceUrl = options.sourceUrl?.trim() || MICROLINK_UA_SOURCE_URL;
		this.staleAfterMs = options.staleAfterMs ?? MICROLINK_UA_STALE_AFTER_MS;
	}

	getSourceUrl(): string {
		return this.sourceUrl;
	}

	getStaleAfterMs(): number {
		return this.staleAfterMs;
	}

	getCachedSnapshot(): MicrolinkUaSnapshotRow | null {
		return $storageKit.selectMicrolinkUaSnapshot();
	}

	getCachedPayload(): MicrolinkUaPayload | null {
		return parseMicrolinkUaPayload(this.getCachedSnapshot()?.payload_json ?? null);
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
		const currentSnapshot = this.getCachedSnapshot();
		const currentPayload = parseMicrolinkUaPayload(currentSnapshot?.payload_json ?? null);
		const fetchedAt = new Date().toISOString();

		try {
			const response = await $axios.get(this.sourceUrl, {
				timeout: this.requestTimeoutMs,
			});
			const payload = normalizeMicrolinkUaPayload(response.data);
			$storageKit.upsertMicrolinkUaSnapshot({
				errorMessage: null,
				fetchStatus: "success",
				fetchedAt,
				microlinkUpdatedAt: payload.updatedAt,
				payloadJson: JSON.stringify(payload),
				sourceUrl: this.sourceUrl,
			});
		} catch (error) {
			$storageKit.upsertMicrolinkUaSnapshot({
				errorMessage: formatRequestError(error),
				fetchStatus: "error",
				fetchedAt,
				microlinkUpdatedAt: currentPayload?.updatedAt ?? currentSnapshot?.microlink_updated_at ?? null,
				payloadJson: currentSnapshot?.payload_json ?? null,
				sourceUrl: this.sourceUrl,
			});
		}

		return await this.getStatus();
	}

	async getStatus(): Promise<MicrolinkUaStatus> {
		const snapshot = this.getCachedSnapshot();
		const payload = parseMicrolinkUaPayload(snapshot?.payload_json ?? null);
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