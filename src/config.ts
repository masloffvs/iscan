import "../config.yml" with { type: "yaml" };
import { YAML, file } from "bun";

import { resolveCwdOrRuntimeFilePath } from "./runtime-paths";

export type BackgroundWorkerResourceLimitsConfig = {
  maxYoungGenerationSizeMb?: number;
  maxOldGenerationSizeMb?: number;
  codeRangeSizeMb?: number;
  stackSizeMb?: number;
};

export type BackgroundWorkerLogRetentionConfig = {
  maxEntriesPerWorker: number;
};

export type ResolvedBackgroundWorkersConfig = {
  smol: boolean;
  metricsIntervalMs: number;
  watchRefreshMs: number;
  resourceLimits: BackgroundWorkerResourceLimitsConfig;
  logRetention: BackgroundWorkerLogRetentionConfig;
};

export type HunterAuthMethod = "api-key" | "bearer";

type RawHunterServiceConfig = {
  AUTH_METHOD?: HunterAuthMethod;
  API_KEY?: string;
  BEARER_TOKEN?: string;
};

type RawStorageConfig = {
  DATABASE_URL?: string;
};

type RawPortScanServiceConfig = {
  ALLOW_HOSTS?: string[];
  DENY_HOSTS?: string[];
  ALLOW_PRIVATE_ADDRESSES?: boolean;
  ALLOW_LOOPBACK?: boolean;
  DENY_PUBLIC_ADDRESSES?: boolean;
};

type RawExploitDbServiceConfig = {
  LIST_URL?: string;
  RAW_URL_TEMPLATE?: string;
  DOWNLOAD_URL_TEMPLATE?: string;
  REFRESH_INTERVAL_MS?: number;
  REQUEST_TIMEOUT_MS?: number;
  PAGE_SIZE?: number;
  RECENT_PAGE_WINDOW?: number;
  BACKFILL_PAGE_BUDGET?: number;
  RAW_FETCH_CONCURRENCY?: number;
  REFRESH_ON_EMPTY?: boolean;
  BACKFILL_ON_EMPTY?: boolean;
};

export type UaSourceKind =
  | "arcjet-well-known-bots"
  | "browscap-json"
  | "cloudflare-bot-directory"
  | "crawler-user-agents"
  | "deviceandbrowserinfo"
  | "microlink-json";

export type UaRecordKind = "exact" | "pattern";

type RawUaSourceConfig = {
  ID?: string;
  KIND?: UaSourceKind;
  URL?: string;
  ENABLED?: boolean;
  CATEGORIES?: string[];
  RECORD_KINDS?: UaRecordKind[];
};

type RawUaServiceConfig = {
  REFRESH_INTERVAL_MS?: number;
  STALE_AFTER_MS?: number;
  REFRESH_ON_EMPTY?: boolean;
  SOURCES?: RawUaSourceConfig[];
};

type RawBackgroundWorkerResourceLimitsConfig = {
  MAX_YOUNG_GENERATION_SIZE_MB?: number;
  MAX_OLD_GENERATION_SIZE_MB?: number;
  CODE_RANGE_SIZE_MB?: number;
  STACK_SIZE_MB?: number;
};

type RawBackgroundWorkersConfig = {
  SMOL?: boolean;
  METRICS_INTERVAL_MS?: number;
  WATCH_REFRESH_MS?: number;
  RESOURCE_LIMITS?: RawBackgroundWorkerResourceLimitsConfig;
  LOG_RETENTION?: {
    MAX_ENTRIES_PER_WORKER?: number;
  };
};

type ConfigType = {
  services: {
    hunter: RawHunterServiceConfig;
    storage?: RawStorageConfig;
    portScan?: RawPortScanServiceConfig;
    exploitdb?: RawExploitDbServiceConfig;
    ua?: RawUaServiceConfig;
  };
  runtime?: {
    backgroundWorkers?: RawBackgroundWorkersConfig;
  };
};

export type ResolvedHunterServiceConfig = {
  authMethod: HunterAuthMethod;
  apiKey?: string;
  bearerToken?: string;
};

export type ResolvedStorageConfig = {
  databaseUrl: string;
};

export type ResolvedPortScanServiceConfig = {
  allowHosts: string[];
  denyHosts: string[];
  allowPrivateAddresses: boolean;
  allowLoopback: boolean;
  denyPublicAddresses: boolean;
};

export type ResolvedExploitDbServiceConfig = {
  listUrl: string;
  rawUrlTemplate: string;
  downloadUrlTemplate: string;
  refreshIntervalMs: number;
  requestTimeoutMs: number;
  pageSize: number;
  recentPageWindow: number;
  backfillPageBudget: number;
  rawFetchConcurrency: number;
  refreshOnEmpty: boolean;
  backfillOnEmpty: boolean;
};

export type ResolvedUaSourceConfig = {
  categories: string[];
  enabled: boolean;
  id: string;
  kind: UaSourceKind;
  recordKinds: UaRecordKind[];
  url: string;
};

export type ResolvedUaServiceConfig = {
  refreshIntervalMs: number;
  refreshOnEmpty: boolean;
  sources: ResolvedUaSourceConfig[];
  staleAfterMs: number;
};

type ResolvedConfigType = {
  services: {
    hunter: ResolvedHunterServiceConfig;
    storage: ResolvedStorageConfig;
    portScan: ResolvedPortScanServiceConfig;
    exploitdb: ResolvedExploitDbServiceConfig;
    ua: ResolvedUaServiceConfig;
  };
  runtime: {
    backgroundWorkers: ResolvedBackgroundWorkersConfig;
  };
};

const DEFAULT_EXPLOITDB_SERVICE_CONFIG: ResolvedExploitDbServiceConfig = {
  listUrl: "https://www.exploit-db.com/",
  rawUrlTemplate: "https://www.exploit-db.com/raw/{id}",
  downloadUrlTemplate: "https://www.exploit-db.com/download/{id}",
  refreshIntervalMs: 1000 * 60 * 60 * 24,
  requestTimeoutMs: 15000,
  pageSize: 15,
  recentPageWindow: 8,
  backfillPageBudget: 64,
  rawFetchConcurrency: 4,
  refreshOnEmpty: true,
  backfillOnEmpty: true,
};

const DEFAULT_UA_SOURCE_CONFIGS: ResolvedUaSourceConfig[] = [
  {
    categories: ["user", "crawler", "ai"],
    enabled: true,
    id: "microlink",
    kind: "microlink-json",
    recordKinds: ["exact"],
    url: "https://microlink.io/user-agents.json",
  },
];

const DEFAULT_UA_SERVICE_CONFIG: ResolvedUaServiceConfig = {
  refreshIntervalMs: 1000 * 60 * 60 * 24,
  refreshOnEmpty: true,
  sources: DEFAULT_UA_SOURCE_CONFIGS,
  staleAfterMs: 1000 * 60 * 60 * 24,
};

const DEFAULT_PORT_SCAN_SERVICE_CONFIG: ResolvedPortScanServiceConfig = {
  allowHosts: ["localhost", "*.local", "*.lan", "*.internal"],
  denyHosts: [],
  allowPrivateAddresses: true,
  allowLoopback: true,
  denyPublicAddresses: true,
};

const DEFAULT_BACKGROUND_WORKER_CONFIG: ResolvedBackgroundWorkersConfig = {
  smol: true,
  metricsIntervalMs: 1000,
  watchRefreshMs: 1000,
  resourceLimits: {
    maxYoungGenerationSizeMb: 16,
    maxOldGenerationSizeMb: 128,
    codeRangeSizeMb: 64,
    stackSizeMb: 8,
  },
  logRetention: {
    maxEntriesPerWorker: 5000,
  },
};

function resolvePositiveInteger(
  value: number | undefined,
  label: string,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function resolveBoolean(
  value: boolean | undefined,
  label: string,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
}

function resolveNonEmptyString(
  value: string | undefined,
  label: string,
  fallback: string,
): string {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return normalized;
}

function resolveStringArray(value: unknown, label: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`);
  }

  const items = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (items.length !== value.length) {
    throw new Error(`${label} must contain only non-empty strings.`);
  }

  return [...new Set(items)];
}

function resolveUaRecordKinds(value: unknown, label: string): UaRecordKind[] {
  const recordKinds = resolveStringArray(value, label);
  if (recordKinds.length === 0) {
    return [...DEFAULT_UA_SERVICE_CONFIG.sources[0]!.recordKinds];
  }

  for (const recordKind of recordKinds) {
    if (recordKind !== "exact" && recordKind !== "pattern") {
      throw new Error(`${label} contains unsupported record kind '${recordKind}'.`);
    }
  }

  return recordKinds as UaRecordKind[];
}

class Config {
  protected config: ResolvedConfigType;

  constructor(config: ConfigType) {
    this.config = {
      services: {
        hunter: this.resolveHunterConfig(config.services.hunter),
        storage: this.resolveStorageConfig(config.services.storage),
			portScan: this.resolvePortScanServiceConfig(config.services.portScan),
        exploitdb: this.resolveExploitDbServiceConfig(config.services.exploitdb),
        ua: this.resolveUaServiceConfig(config.services.ua),
      },
      runtime: {
        backgroundWorkers: this.resolveBackgroundWorkersConfig(config.runtime?.backgroundWorkers),
      },
    };
  }

  get services(): ResolvedConfigType["services"] {
    return this.config.services;
  }

  get runtime(): ResolvedConfigType["runtime"] {
    return this.config.runtime;
  }

  private resolveStorageConfig(
    storageConfig?: RawStorageConfig,
  ): ResolvedStorageConfig {
    return {
      databaseUrl: storageConfig?.DATABASE_URL || "sqlite.db",
    };
  }

  private resolvePortScanServiceConfig(
    portScanConfig?: RawPortScanServiceConfig,
  ): ResolvedPortScanServiceConfig {
    return {
      allowHosts: (resolveStringArray(
        portScanConfig?.ALLOW_HOSTS,
        "services.portScan.ALLOW_HOSTS",
      ).length > 0
        ? resolveStringArray(portScanConfig?.ALLOW_HOSTS, "services.portScan.ALLOW_HOSTS")
        : DEFAULT_PORT_SCAN_SERVICE_CONFIG.allowHosts
      ).map((entry) => entry.toLowerCase()),
      denyHosts: resolveStringArray(
        portScanConfig?.DENY_HOSTS,
        "services.portScan.DENY_HOSTS",
      ).map((entry) => entry.toLowerCase()),
      allowPrivateAddresses: resolveBoolean(
        portScanConfig?.ALLOW_PRIVATE_ADDRESSES,
        "services.portScan.ALLOW_PRIVATE_ADDRESSES",
        DEFAULT_PORT_SCAN_SERVICE_CONFIG.allowPrivateAddresses,
      ),
      allowLoopback: resolveBoolean(
        portScanConfig?.ALLOW_LOOPBACK,
        "services.portScan.ALLOW_LOOPBACK",
        DEFAULT_PORT_SCAN_SERVICE_CONFIG.allowLoopback,
      ),
      denyPublicAddresses: resolveBoolean(
        portScanConfig?.DENY_PUBLIC_ADDRESSES,
        "services.portScan.DENY_PUBLIC_ADDRESSES",
        DEFAULT_PORT_SCAN_SERVICE_CONFIG.denyPublicAddresses,
      ),
    };
  }

  private resolveExploitDbServiceConfig(
    exploitDbConfig?: RawExploitDbServiceConfig,
  ): ResolvedExploitDbServiceConfig {
    return {
      listUrl: resolveNonEmptyString(
        exploitDbConfig?.LIST_URL,
        "services.exploitdb.LIST_URL",
        DEFAULT_EXPLOITDB_SERVICE_CONFIG.listUrl,
      ),
      rawUrlTemplate: resolveNonEmptyString(
        exploitDbConfig?.RAW_URL_TEMPLATE,
        "services.exploitdb.RAW_URL_TEMPLATE",
        DEFAULT_EXPLOITDB_SERVICE_CONFIG.rawUrlTemplate,
      ),
      downloadUrlTemplate: resolveNonEmptyString(
        exploitDbConfig?.DOWNLOAD_URL_TEMPLATE,
        "services.exploitdb.DOWNLOAD_URL_TEMPLATE",
        DEFAULT_EXPLOITDB_SERVICE_CONFIG.downloadUrlTemplate,
      ),
      refreshIntervalMs: resolvePositiveInteger(
        exploitDbConfig?.REFRESH_INTERVAL_MS,
        "services.exploitdb.REFRESH_INTERVAL_MS",
        DEFAULT_EXPLOITDB_SERVICE_CONFIG.refreshIntervalMs,
      ),
      requestTimeoutMs: resolvePositiveInteger(
        exploitDbConfig?.REQUEST_TIMEOUT_MS,
        "services.exploitdb.REQUEST_TIMEOUT_MS",
        DEFAULT_EXPLOITDB_SERVICE_CONFIG.requestTimeoutMs,
      ),
      pageSize: resolvePositiveInteger(
        exploitDbConfig?.PAGE_SIZE,
        "services.exploitdb.PAGE_SIZE",
        DEFAULT_EXPLOITDB_SERVICE_CONFIG.pageSize,
      ),
      recentPageWindow: resolvePositiveInteger(
        exploitDbConfig?.RECENT_PAGE_WINDOW,
        "services.exploitdb.RECENT_PAGE_WINDOW",
        DEFAULT_EXPLOITDB_SERVICE_CONFIG.recentPageWindow,
      ),
      backfillPageBudget: resolvePositiveInteger(
        exploitDbConfig?.BACKFILL_PAGE_BUDGET,
        "services.exploitdb.BACKFILL_PAGE_BUDGET",
        DEFAULT_EXPLOITDB_SERVICE_CONFIG.backfillPageBudget,
      ),
      rawFetchConcurrency: resolvePositiveInteger(
        exploitDbConfig?.RAW_FETCH_CONCURRENCY,
        "services.exploitdb.RAW_FETCH_CONCURRENCY",
        DEFAULT_EXPLOITDB_SERVICE_CONFIG.rawFetchConcurrency,
      ),
      refreshOnEmpty: resolveBoolean(
        exploitDbConfig?.REFRESH_ON_EMPTY,
        "services.exploitdb.REFRESH_ON_EMPTY",
        DEFAULT_EXPLOITDB_SERVICE_CONFIG.refreshOnEmpty,
      ),
      backfillOnEmpty: resolveBoolean(
        exploitDbConfig?.BACKFILL_ON_EMPTY,
        "services.exploitdb.BACKFILL_ON_EMPTY",
        DEFAULT_EXPLOITDB_SERVICE_CONFIG.backfillOnEmpty,
      ),
    };
  }

  private resolveHunterConfig(
    hunterConfig: RawHunterServiceConfig,
  ): ResolvedHunterServiceConfig {
    const authMethod = hunterConfig.AUTH_METHOD ?? "api-key";
    const apiKey = hunterConfig.API_KEY?.trim();
    const bearerToken = hunterConfig.BEARER_TOKEN?.trim();

    if (authMethod !== "api-key" && authMethod !== "bearer") {
      throw new Error('Hunter AUTH_METHOD must be either "api-key" or "bearer".');
    }

    if (authMethod === "api-key" && !apiKey) {
      throw new Error("Hunter API key is missing in the configuration.");
    }

    if (authMethod === "bearer" && !bearerToken) {
      throw new Error("Hunter bearer token is missing in the configuration.");
    }

    return {
      authMethod,
      apiKey,
      bearerToken,
    };
  }

  private resolveUaServiceConfig(
    uaConfig?: RawUaServiceConfig,
  ): ResolvedUaServiceConfig {
    const rawSources = uaConfig?.SOURCES;
    const sources = (() => {
      if (!rawSources || rawSources.length === 0) {
        return DEFAULT_UA_SERVICE_CONFIG.sources.map((source) => ({
          ...source,
          categories: [...source.categories],
          recordKinds: [...source.recordKinds],
        }));
      }

      const seenIds = new Set<string>();
      return rawSources.map((source, index) => {
        const labelPrefix = `services.ua.SOURCES[${index}]`;
        const id = source.ID?.trim();
        const url = source.URL?.trim();
        const kind = source.KIND;

        if (!id) {
          throw new Error(`${labelPrefix}.ID is required.`);
        }

        if (seenIds.has(id)) {
          throw new Error(`${labelPrefix}.ID '${id}' is duplicated.`);
        }

        if (!url) {
          throw new Error(`${labelPrefix}.URL is required.`);
        }

        if (!kind) {
          throw new Error(`${labelPrefix}.KIND is required.`);
        }

        if (!["arcjet-well-known-bots", "browscap-json", "cloudflare-bot-directory", "crawler-user-agents", "deviceandbrowserinfo", "microlink-json"].includes(kind)) {
          throw new Error(`${labelPrefix}.KIND '${kind}' is not supported.`);
        }

        seenIds.add(id);
        return {
          categories: resolveStringArray(source.CATEGORIES, `${labelPrefix}.CATEGORIES`),
          enabled: resolveBoolean(source.ENABLED, `${labelPrefix}.ENABLED`, true),
          id,
          kind,
          recordKinds: resolveUaRecordKinds(source.RECORD_KINDS, `${labelPrefix}.RECORD_KINDS`),
          url,
        };
      });
    })();

    return {
      refreshIntervalMs: resolvePositiveInteger(
        uaConfig?.REFRESH_INTERVAL_MS,
        "services.ua.REFRESH_INTERVAL_MS",
        DEFAULT_UA_SERVICE_CONFIG.refreshIntervalMs,
      ),
      refreshOnEmpty: resolveBoolean(
        uaConfig?.REFRESH_ON_EMPTY,
        "services.ua.REFRESH_ON_EMPTY",
        DEFAULT_UA_SERVICE_CONFIG.refreshOnEmpty,
      ),
      sources,
      staleAfterMs: resolvePositiveInteger(
        uaConfig?.STALE_AFTER_MS,
        "services.ua.STALE_AFTER_MS",
        DEFAULT_UA_SERVICE_CONFIG.staleAfterMs,
      ),
    };
  }

  private resolveBackgroundWorkersConfig(
    workersConfig?: RawBackgroundWorkersConfig,
  ): ResolvedBackgroundWorkersConfig {
    const resourceLimits = workersConfig?.RESOURCE_LIMITS;
    const logRetention = workersConfig?.LOG_RETENTION;

    return {
      smol: workersConfig?.SMOL ?? DEFAULT_BACKGROUND_WORKER_CONFIG.smol,
      metricsIntervalMs: resolvePositiveInteger(
        workersConfig?.METRICS_INTERVAL_MS,
        "runtime.backgroundWorkers.METRICS_INTERVAL_MS",
        DEFAULT_BACKGROUND_WORKER_CONFIG.metricsIntervalMs,
      ),
      watchRefreshMs: resolvePositiveInteger(
        workersConfig?.WATCH_REFRESH_MS,
        "runtime.backgroundWorkers.WATCH_REFRESH_MS",
        DEFAULT_BACKGROUND_WORKER_CONFIG.watchRefreshMs,
      ),
      resourceLimits: {
        maxYoungGenerationSizeMb: resolvePositiveInteger(
          resourceLimits?.MAX_YOUNG_GENERATION_SIZE_MB,
          "runtime.backgroundWorkers.RESOURCE_LIMITS.MAX_YOUNG_GENERATION_SIZE_MB",
          DEFAULT_BACKGROUND_WORKER_CONFIG.resourceLimits.maxYoungGenerationSizeMb ?? 16,
        ),
        maxOldGenerationSizeMb: resolvePositiveInteger(
          resourceLimits?.MAX_OLD_GENERATION_SIZE_MB,
          "runtime.backgroundWorkers.RESOURCE_LIMITS.MAX_OLD_GENERATION_SIZE_MB",
          DEFAULT_BACKGROUND_WORKER_CONFIG.resourceLimits.maxOldGenerationSizeMb ?? 128,
        ),
        codeRangeSizeMb: resolvePositiveInteger(
          resourceLimits?.CODE_RANGE_SIZE_MB,
          "runtime.backgroundWorkers.RESOURCE_LIMITS.CODE_RANGE_SIZE_MB",
          DEFAULT_BACKGROUND_WORKER_CONFIG.resourceLimits.codeRangeSizeMb ?? 64,
        ),
        stackSizeMb: resolvePositiveInteger(
          resourceLimits?.STACK_SIZE_MB,
          "runtime.backgroundWorkers.RESOURCE_LIMITS.STACK_SIZE_MB",
          DEFAULT_BACKGROUND_WORKER_CONFIG.resourceLimits.stackSizeMb ?? 8,
        ),
      },
      logRetention: {
        maxEntriesPerWorker: resolvePositiveInteger(
          logRetention?.MAX_ENTRIES_PER_WORKER,
          "runtime.backgroundWorkers.LOG_RETENTION.MAX_ENTRIES_PER_WORKER",
          DEFAULT_BACKGROUND_WORKER_CONFIG.logRetention.maxEntriesPerWorker,
        ),
      },
    };
  }
}

class ConfigLoader {
  static async loadConfig(): Promise<Config> {
    const configContent = await file(resolveCwdOrRuntimeFilePath("config.yml")).text();
    const configData = YAML.parse(configContent) as ConfigType;
    return new Config(configData);
  }
}

export const $config: Config = await ConfigLoader.loadConfig();
