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

type ResolvedConfigType = {
  services: {
    hunter: ResolvedHunterServiceConfig;
    storage: ResolvedStorageConfig;
  };
  runtime: {
    backgroundWorkers: ResolvedBackgroundWorkersConfig;
  };
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

class Config {
  protected config: ResolvedConfigType;

  constructor(config: ConfigType) {
    this.config = {
      services: {
        hunter: this.resolveHunterConfig(config.services.hunter),
        storage: this.resolveStorageConfig(config.services.storage),
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
