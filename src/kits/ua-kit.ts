import type { AxiosError } from "axios";

import { $axios } from "../axios";
import {
  $config,
  type ResolvedUaServiceConfig,
  type ResolvedUaSourceConfig,
  type UaSourceKind,
} from "../config";

import { buildCloakUserAgentOptions } from "./cloak-profile-editor";
import { Kit, type KitInfo } from "./kit";
import {
  $storageKit,
  type PersistedUaExactAgentRecord,
  type PersistedUaPatternRecord,
  type UaExactAgentRow,
  type UaPatternRow,
  type UaSourceRow,
  type UaSourceSyncStatus,
} from "./storage-kit";

export const UA_KIT_ID = "ua";
export const UA_MICROLINK_SOURCE_ID = "microlink";

const UA_REQUEST_TIMEOUT_MS = 15000;

const UA_KIT_INFO: KitInfo = {
  id: UA_KIT_ID,
  name: "UaKit",
  category: "service",
  description: "Unified parsed user-agent source aggregator backed by SQLite.",
  tags: ["user-agent", "http", "sqlite", "crawler"],
};

type JsonRecord = Record<string, unknown>;

type NormalizedExactAgentRecord = {
  category: string;
  description: string | null;
  disposition: string;
  displayName: string | null;
  metadata: JsonRecord | null;
  sourceRecordId: string | null;
  userAgent: string;
};

type NormalizedPatternRecord = {
  category: string;
  description: string | null;
  disposition: string;
  displayName: string | null;
  metadata: JsonRecord | null;
  pattern: string;
  sourceRecordId: string | null;
};

type NormalizedSourcePayload = {
  exactAgents: NormalizedExactAgentRecord[];
  metadata: JsonRecord | null;
  patterns: NormalizedPatternRecord[];
};

export type UaKitOptions = {
  config?: ResolvedUaServiceConfig;
  requestTimeoutMs?: number;
};

export type UaExactAgent = {
  browserFamily: string | null;
  browserVersion: string | null;
  category: string;
  description: string | null;
  deviceClass: string | null;
  disposition: string;
  displayName: string | null;
  fetchedAt: string;
  id: number;
  label: string;
  metadata: JsonRecord | null;
  osFamily: string | null;
  sourceId: string;
  sourceKind: string;
  sourceRecordId: string | null;
  sourceUrl: string;
  userAgent: string;
};

export type UaPattern = {
  category: string;
  description: string | null;
  disposition: string;
  displayName: string | null;
  fetchedAt: string;
  id: number;
  metadata: JsonRecord | null;
  pattern: string;
  sourceId: string;
  sourceKind: string;
  sourceRecordId: string | null;
  sourceUrl: string;
};

export type UaSourceStatus = {
  enabled: boolean;
  errorMessage: string | null;
  exactAgentCount: number;
  fetchStatus: "empty" | UaSourceSyncStatus;
  fetchedAt: string | null;
  isStale: boolean;
  metadata: JsonRecord | null;
  patternCount: number;
  sourceId: string;
  sourceKind: UaSourceKind;
  sourceUrl: string;
};

export type UaExactAgentFilters = {
  browserFamilies?: readonly string[];
  browserVersions?: readonly string[];
  categories?: readonly string[];
  deviceClasses?: readonly string[];
  dispositions?: readonly string[];
  limit?: number;
  offset?: number;
  osFamilies?: readonly string[];
  search?: string;
  sourceIds?: readonly string[];
};

export type UaPatternFilters = {
  categories?: readonly string[];
  dispositions?: readonly string[];
  limit?: number;
  offset?: number;
  search?: string;
  sourceIds?: readonly string[];
};

export type UaRefreshResult = {
  exactAgentCount: number;
  patternCount: number;
  refreshedAt: string;
  refreshedSourceIds: string[];
  sources: UaSourceStatus[];
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of value) {
    const normalized = normalizeString(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    items.push(normalized);
  }

  return items;
}

function normalizeCategory(value: string | null | undefined): string {
  const normalized = (value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "unknown";
}

function normalizeCategoryList(values: readonly string[]): string[] {
  const categories = values
    .map((value) => normalizeCategory(value))
    .filter((value, index, items) => items.indexOf(value) === index);
  return categories.length > 0 ? categories : ["unknown"];
}

function normalizeOptionalMetadata(value: JsonRecord | null): string | null {
  if (!value || Object.keys(value).length === 0) {
    return null;
  }

  return JSON.stringify(value);
}

function parseMetadata(value: string | null): JsonRecord | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
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
    return `UA source request failed with status ${axiosError.response.status}.`;
  }

  return String(error);
}

function shouldIncludeRecordKind(source: ResolvedUaSourceConfig, kind: "exact" | "pattern"): boolean {
  return source.recordKinds.includes(kind);
}

function shouldIncludeCategory(source: ResolvedUaSourceConfig, category: string): boolean {
  if (source.categories.length === 0) {
    return true;
  }

  return source.categories.includes(category);
}

function dedupeExactAgents(records: readonly NormalizedExactAgentRecord[]): NormalizedExactAgentRecord[] {
  const seen = new Set<string>();
  const deduped: NormalizedExactAgentRecord[] = [];
  for (const record of records) {
    const key = [
      record.sourceRecordId ?? "",
      record.category,
      record.disposition,
      record.userAgent,
    ].join("\u0000");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(record);
  }

  return deduped;
}

function dedupePatterns(records: readonly NormalizedPatternRecord[]): NormalizedPatternRecord[] {
  const seen = new Set<string>();
  const deduped: NormalizedPatternRecord[] = [];
  for (const record of records) {
    const key = [
      record.sourceRecordId ?? "",
      record.category,
      record.disposition,
      record.pattern,
    ].join("\u0000");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(record);
  }

  return deduped;
}

function createCamelExactAgent(row: UaExactAgentRow): UaExactAgent {
  return {
    browserFamily: row.browser_family,
    browserVersion: row.browser_version,
    category: row.category,
    description: row.description,
    deviceClass: row.device_class,
    disposition: row.disposition,
    displayName: row.display_name,
    fetchedAt: row.fetched_at,
    id: row.id,
    label: row.label,
    metadata: parseMetadata(row.metadata_json),
    osFamily: row.os_family,
    sourceId: row.source_id,
    sourceKind: row.source_kind,
    sourceRecordId: row.source_record_id,
    sourceUrl: row.source_url,
    userAgent: row.user_agent,
  };
}

function createCamelPattern(row: UaPatternRow): UaPattern {
  return {
    category: row.category,
    description: row.description,
    disposition: row.disposition,
    displayName: row.display_name,
    fetchedAt: row.fetched_at,
    id: row.id,
    metadata: parseMetadata(row.metadata_json),
    pattern: row.pattern,
    sourceId: row.source_id,
    sourceKind: row.source_kind,
    sourceRecordId: row.source_record_id,
    sourceUrl: row.source_url,
  };
}

function createSourceStatus(source: ResolvedUaSourceConfig, row: UaSourceRow | null, staleAfterMs: number): UaSourceStatus {
  const fetchedAt = row?.fetched_at ?? null;
  const isStale = fetchedAt ? (Date.now() - Date.parse(fetchedAt)) > staleAfterMs : true;
  return {
    enabled: row ? row.enabled === 1 : source.enabled,
    errorMessage: row?.error_message ?? null,
    exactAgentCount: row?.exact_agent_count ?? 0,
    fetchStatus: row?.fetch_status ?? "empty",
    fetchedAt,
    isStale,
    metadata: parseMetadata(row?.metadata_json ?? null),
    patternCount: row?.pattern_count ?? 0,
    sourceId: source.id,
    sourceKind: source.kind,
    sourceUrl: row?.source_url ?? source.url,
  };
}

function matchesStringFilter(value: string | null | undefined, filters?: readonly string[]): boolean {
  if (!filters || filters.length === 0) {
    return true;
  }

  if (!value) {
    return false;
  }

  return filters.includes(value);
}

function matchesSearch(search: string | undefined, haystack: Array<string | null | undefined>): boolean {
  if (!search) {
    return true;
  }

  const normalizedSearch = search.trim().toLowerCase();
  if (normalizedSearch.length === 0) {
    return true;
  }

  return haystack.some((entry) => typeof entry === "string" && entry.toLowerCase().includes(normalizedSearch));
}

export class UaKit extends Kit {
  private readonly config: ResolvedUaServiceConfig;
  private readonly requestTimeoutMs: number;

  constructor(options: UaKitOptions = {}) {
    super(UA_KIT_INFO);
    this.config = options.config ?? $config.services.ua;
    this.requestTimeoutMs = options.requestTimeoutMs ?? UA_REQUEST_TIMEOUT_MS;
  }

  getConfig(): ResolvedUaServiceConfig {
    return this.config;
  }

  async getSourceStatuses(): Promise<UaSourceStatus[]> {
    const sourceRowsById = new Map(
      $storageKit.selectUaSources().map((row) => [row.source_id, row]),
    );

    return this.config.sources.map((source) => createSourceStatus(
      source,
      sourceRowsById.get(source.id) ?? null,
      this.config.staleAfterMs,
    ));
  }

  async listExactAgents(filters: UaExactAgentFilters = {}): Promise<UaExactAgent[]> {
    await this.ensurePopulated();
    const rows = $storageKit.selectUaExactAgents().map(createCamelExactAgent).filter((row) => {
      return matchesStringFilter(row.sourceId, filters.sourceIds)
        && matchesStringFilter(row.category, filters.categories)
        && matchesStringFilter(row.disposition, filters.dispositions)
        && matchesStringFilter(row.browserFamily, filters.browserFamilies)
        && matchesStringFilter(row.browserVersion, filters.browserVersions)
        && matchesStringFilter(row.osFamily, filters.osFamilies)
        && matchesStringFilter(row.deviceClass, filters.deviceClasses)
        && matchesSearch(filters.search, [
          row.userAgent,
          row.label,
          row.displayName,
          row.description,
          row.sourceRecordId,
          row.category,
          row.sourceId,
        ]);
    });

    const offset = Math.max(filters.offset ?? 0, 0);
    const limit = filters.limit && filters.limit > 0 ? filters.limit : rows.length;
    return rows.slice(offset, offset + limit);
  }

  async listPatterns(filters: UaPatternFilters = {}): Promise<UaPattern[]> {
    await this.ensurePopulated();
    const rows = $storageKit.selectUaPatterns().map(createCamelPattern).filter((row) => {
      return matchesStringFilter(row.sourceId, filters.sourceIds)
        && matchesStringFilter(row.category, filters.categories)
        && matchesStringFilter(row.disposition, filters.dispositions)
        && matchesSearch(filters.search, [
          row.pattern,
          row.displayName,
          row.description,
          row.sourceRecordId,
          row.category,
          row.sourceId,
        ]);
    });

    const offset = Math.max(filters.offset ?? 0, 0);
    const limit = filters.limit && filters.limit > 0 ? filters.limit : rows.length;
    return rows.slice(offset, offset + limit);
  }

  async refresh(sourceIds?: readonly string[]): Promise<UaRefreshResult> {
    const targetSourceIds = new Set(sourceIds ?? []);
    const sources = this.config.sources.filter((source) => {
      if (!source.enabled) {
        return false;
      }

      return targetSourceIds.size === 0 || targetSourceIds.has(source.id);
    });

    const currentSourceRowsById = new Map(
      $storageKit.selectUaSources().map((row) => [row.source_id, row]),
    );
    const currentExactCounts = this.countRowsBySource($storageKit.selectUaExactAgents().map((row) => row.source_id));
    const currentPatternCounts = this.countRowsBySource($storageKit.selectUaPatterns().map((row) => row.source_id));
    const refreshedAt = new Date().toISOString();

    for (const source of sources) {
      try {
        const normalized = await this.fetchAndNormalizeSource(source);
        const exactAgents = this.createPersistedExactAgents(source, normalized.exactAgents, refreshedAt);
        const patterns = this.createPersistedPatterns(source, normalized.patterns, refreshedAt);
        $storageKit.replaceUaExactAgentsForSource(source.id, exactAgents);
        $storageKit.replaceUaPatternsForSource(source.id, patterns);
        $storageKit.upsertUaSource({
          enabled: source.enabled,
          errorMessage: null,
          exactAgentCount: exactAgents.length,
          fetchStatus: "success",
          fetchedAt: refreshedAt,
          metadataJson: normalizeOptionalMetadata(normalized.metadata),
          patternCount: patterns.length,
          sourceId: source.id,
          sourceKind: source.kind,
          sourceUrl: source.url,
        });
      } catch (error) {
        const currentSourceRow = currentSourceRowsById.get(source.id) ?? null;
        $storageKit.upsertUaSource({
          enabled: source.enabled,
          errorMessage: formatRequestError(error),
          exactAgentCount: currentExactCounts.get(source.id) ?? 0,
          fetchStatus: "error",
          fetchedAt: refreshedAt,
          metadataJson: currentSourceRow?.metadata_json ?? null,
          patternCount: currentPatternCounts.get(source.id) ?? 0,
          sourceId: source.id,
          sourceKind: source.kind,
          sourceUrl: source.url,
        });
      }
    }

    const sourceStatuses = await this.getSourceStatuses();
    return {
      exactAgentCount: sourceStatuses.reduce((sum, source) => sum + source.exactAgentCount, 0),
      patternCount: sourceStatuses.reduce((sum, source) => sum + source.patternCount, 0),
      refreshedAt,
      refreshedSourceIds: sources.map((source) => source.id),
      sources: sourceStatuses,
    };
  }

  private countRowsBySource(sourceIds: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const sourceId of sourceIds) {
      counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1);
    }

    return counts;
  }

  private async ensurePopulated(): Promise<void> {
    if (!this.config.refreshOnEmpty) {
      return;
    }

    const hasExactAgents = $storageKit.selectUaExactAgents().length > 0;
    const hasPatterns = $storageKit.selectUaPatterns().length > 0;
    if (hasExactAgents || hasPatterns) {
      return;
    }

    await this.refresh();
  }

  private async fetchAndNormalizeSource(source: ResolvedUaSourceConfig): Promise<NormalizedSourcePayload> {
    const response = await $axios.get(source.url, {
      timeout: this.requestTimeoutMs,
    });

    switch (source.kind) {
      case "microlink-json":
        return this.normalizeMicrolinkSource(source, response.data);
      case "arcjet-well-known-bots":
        return this.normalizeArcjetSource(source, response.data);
      case "cloudflare-bot-directory":
        return this.normalizeCloudflareSource(source, response.data);
      case "crawler-user-agents":
        return this.normalizeCrawlerUserAgentsSource(source, response.data);
      default:
        throw new Error(`UA source kind '${source.kind}' is not implemented yet.`);
    }
  }

  private normalizeMicrolinkSource(source: ResolvedUaSourceConfig, value: unknown): NormalizedSourcePayload {
    if (!isRecord(value)) {
      throw new Error("Microlink UA payload must be an object.");
    }

    const exactAgents: NormalizedExactAgentRecord[] = [];
    const categories: Array<{ key: "ai" | "crawler" | "user"; category: string }> = [
      { key: "user", category: "user" },
      { key: "crawler", category: "crawler" },
      { key: "ai", category: "ai" },
    ];

    for (const entry of categories) {
      if (!shouldIncludeCategory(source, entry.category) || !shouldIncludeRecordKind(source, "exact")) {
        continue;
      }

      for (const userAgent of normalizeStringArray(value[entry.key])) {
        exactAgents.push({
          category: entry.category,
          description: null,
          disposition: "observed",
          displayName: null,
          metadata: null,
          sourceRecordId: entry.key,
          userAgent,
        });
      }
    }

    const updatedAt = typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
      ? Math.trunc(value.updatedAt)
      : null;

    return {
      exactAgents: dedupeExactAgents(exactAgents),
      metadata: updatedAt ? { updatedAt } : null,
      patterns: [],
    };
  }

  private normalizeArcjetSource(source: ResolvedUaSourceConfig, value: unknown): NormalizedSourcePayload {
    if (!Array.isArray(value)) {
      throw new Error("Arcjet well-known bots payload must be an array.");
    }

    const exactAgents: NormalizedExactAgentRecord[] = [];
    const patterns: NormalizedPatternRecord[] = [];

    for (const rawEntry of value) {
      if (!isRecord(rawEntry)) {
        continue;
      }

      const sourceRecordId = normalizeString(rawEntry.id);
      const description = normalizeString(rawEntry.description);
      const url = normalizeString(rawEntry.url);
      const additionDate = normalizeString(rawEntry.addition_date);
      const aliases = normalizeStringArray(rawEntry.aliases);
      const verification = Array.isArray(rawEntry.verification) ? rawEntry.verification : [];
      const categories = normalizeCategoryList(normalizeStringArray(rawEntry.categories));
      const metadata = {
        additionDate,
        aliases,
        url,
        verification,
      } satisfies JsonRecord;
      const instances = isRecord(rawEntry.instances) ? rawEntry.instances : {};
      const patternBlock = isRecord(rawEntry.pattern) ? rawEntry.pattern : {};

      if (shouldIncludeRecordKind(source, "exact")) {
        for (const category of categories) {
          if (!shouldIncludeCategory(source, category)) {
            continue;
          }

          for (const userAgent of normalizeStringArray(instances.accepted)) {
            exactAgents.push({
              category,
              description,
              disposition: "accepted",
              displayName: sourceRecordId,
              metadata,
              sourceRecordId,
              userAgent,
            });
          }

          for (const userAgent of normalizeStringArray(instances.rejected)) {
            exactAgents.push({
              category,
              description,
              disposition: "rejected",
              displayName: sourceRecordId,
              metadata,
              sourceRecordId,
              userAgent,
            });
          }
        }
      }

      if (shouldIncludeRecordKind(source, "pattern")) {
        for (const category of categories) {
          if (!shouldIncludeCategory(source, category)) {
            continue;
          }

          for (const pattern of normalizeStringArray(patternBlock.accepted)) {
            patterns.push({
              category,
              description,
              disposition: "accepted",
              displayName: sourceRecordId,
              metadata,
              pattern,
              sourceRecordId,
            });
          }

          for (const pattern of normalizeStringArray(patternBlock.forbidden)) {
            patterns.push({
              category,
              description,
              disposition: "forbidden",
              displayName: sourceRecordId,
              metadata,
              pattern,
              sourceRecordId,
            });
          }
        }
      }
    }

    return {
      exactAgents: dedupeExactAgents(exactAgents),
      metadata: { entryCount: value.length },
      patterns: dedupePatterns(patterns),
    };
  }

  private normalizeCloudflareSource(source: ResolvedUaSourceConfig, value: unknown): NormalizedSourcePayload {
    if (!Array.isArray(value)) {
      throw new Error("Cloudflare bot directory payload must be an array.");
    }

    const exactAgents: NormalizedExactAgentRecord[] = [];
    const patterns: NormalizedPatternRecord[] = [];

    for (const rawEntry of value) {
      if (!isRecord(rawEntry)) {
        continue;
      }

      const category = normalizeCategory(normalizeString(rawEntry.category));
      if (!shouldIncludeCategory(source, category)) {
        continue;
      }

      const sourceRecordId = normalizeString(rawEntry.slug);
      const displayName = normalizeString(rawEntry.name);
      const description = normalizeString(rawEntry.description);
      const metadata = {
        followsRobotsTxt: typeof rawEntry.followsRobotsTxt === "boolean" ? rawEntry.followsRobotsTxt : null,
        kind: normalizeString(rawEntry.kind),
        operator: normalizeString(rawEntry.operator),
        operatorUrl: normalizeString(rawEntry.operatorUrl),
        signatureAgentUrl: normalizeString(rawEntry.signatureAgentUrl),
      } satisfies JsonRecord;

      if (shouldIncludeRecordKind(source, "exact")) {
        for (const userAgent of normalizeStringArray(rawEntry.userAgents)) {
          exactAgents.push({
            category,
            description,
            disposition: "declared",
            displayName,
            metadata,
            sourceRecordId,
            userAgent,
          });
        }
      }

      if (shouldIncludeRecordKind(source, "pattern")) {
        for (const pattern of normalizeStringArray(rawEntry.userAgentPatterns)) {
          patterns.push({
            category,
            description,
            disposition: "declared",
            displayName,
            metadata,
            pattern,
            sourceRecordId,
          });
        }
      }
    }

    return {
      exactAgents: dedupeExactAgents(exactAgents),
      metadata: { entryCount: value.length },
      patterns: dedupePatterns(patterns),
    };
  }

  private normalizeCrawlerUserAgentsSource(source: ResolvedUaSourceConfig, value: unknown): NormalizedSourcePayload {
    if (!Array.isArray(value)) {
      throw new Error("Crawler user-agents payload must be an array.");
    }

    const exactAgents: NormalizedExactAgentRecord[] = [];
    const patterns: NormalizedPatternRecord[] = [];

    for (const rawEntry of value) {
      if (!isRecord(rawEntry)) {
        continue;
      }

      const sourceRecordId = normalizeString(rawEntry.pattern);
      const description = normalizeString(rawEntry.description);
      const displayName = description ?? sourceRecordId;
      const metadata = {
        additionDate: normalizeString(rawEntry.addition_date),
        url: normalizeString(rawEntry.url),
      } satisfies JsonRecord;
      const categories = normalizeCategoryList(normalizeStringArray(rawEntry.tags));

      if (shouldIncludeRecordKind(source, "exact")) {
        for (const category of categories) {
          if (!shouldIncludeCategory(source, category)) {
            continue;
          }

          for (const userAgent of normalizeStringArray(rawEntry.instances)) {
            exactAgents.push({
              category,
              description,
              disposition: "declared",
              displayName,
              metadata,
              sourceRecordId,
              userAgent,
            });
          }
        }
      }

      if (sourceRecordId && shouldIncludeRecordKind(source, "pattern")) {
        for (const category of categories) {
          if (!shouldIncludeCategory(source, category)) {
            continue;
          }

          patterns.push({
            category,
            description,
            disposition: "declared",
            displayName,
            metadata,
            pattern: sourceRecordId,
            sourceRecordId,
          });
        }
      }
    }

    return {
      exactAgents: dedupeExactAgents(exactAgents),
      metadata: { entryCount: value.length },
      patterns: dedupePatterns(patterns),
    };
  }

  private createPersistedExactAgents(
    source: ResolvedUaSourceConfig,
    records: readonly NormalizedExactAgentRecord[],
    fetchedAt: string,
  ): PersistedUaExactAgentRecord[] {
    const parsedOptionsByUserAgent = new Map(
      buildCloakUserAgentOptions(records.map((record) => record.userAgent)).map((record) => [record.userAgent, record]),
    );

    return records.map((record) => {
      const parsed = parsedOptionsByUserAgent.get(record.userAgent);
      return {
        browserFamily: parsed?.browserFamily ?? null,
        browserVersion: parsed?.browserVersion ?? null,
        category: record.category,
        description: record.description,
        deviceClass: parsed?.deviceClass ?? null,
        disposition: record.disposition,
        displayName: record.displayName,
        fetchedAt,
        label: record.displayName ?? parsed?.label ?? record.userAgent,
        metadataJson: normalizeOptionalMetadata(record.metadata),
        osFamily: parsed?.osFamily ?? null,
        sourceId: source.id,
        sourceKind: source.kind,
        sourceRecordId: record.sourceRecordId,
        sourceUrl: source.url,
        userAgent: record.userAgent,
      };
    });
  }

  private createPersistedPatterns(
    source: ResolvedUaSourceConfig,
    records: readonly NormalizedPatternRecord[],
    fetchedAt: string,
  ): PersistedUaPatternRecord[] {
    return records.map((record) => ({
      category: record.category,
      description: record.description,
      disposition: record.disposition,
      displayName: record.displayName,
      fetchedAt,
      metadataJson: normalizeOptionalMetadata(record.metadata),
      pattern: record.pattern,
      sourceId: source.id,
      sourceKind: source.kind,
      sourceRecordId: record.sourceRecordId,
      sourceUrl: source.url,
    }));
  }
}