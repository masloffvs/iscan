import "../config.yml" with { type: "yaml" };

import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";

import { YAML, file } from "bun";

import { resolveCwdOrRuntimeFilePath } from "./runtime-paths";

const CONFIG_PATH = "config.yml";

const DEFAULT_MANIFEST_DEPENDENCIES = {
  bwrap: {
    binary: "bwrap",
    aliases: ["bubblewrap"],
    required: false,
    description: "Bubblewrap sandbox used to execute commands inside bpkg boxes.",
  },
  git: {
    binary: "git",
    aliases: [],
    required: false,
    description: "Git CLI used to clone AUR package repositories for review.",
  },
  pacman: {
    binary: "pacman",
    aliases: [],
    required: false,
    description: "Arch Linux package manager used for system package operations.",
  },
  paru: {
    binary: "paru",
    aliases: [],
    required: false,
    description: "AUR helper used for Arch Linux package and AUR workflows.",
  },
  pacstrap: {
    binary: "pacstrap",
    aliases: [],
    required: false,
    description: "Arch bootstrap tool used to build bpkg box root filesystems.",
  },
  proxychains: {
    binary: "proxychains4",
    aliases: ["proxychains"],
    required: true,
    description: "Proxy wrapper used before launching qemu.",
  },
  "qemu-system": {
    binary: "qemu-system-x86_64",
    aliases: [],
    required: true,
    description: "QEMU system emulator used to run virtual machines.",
  },
  "qemu-img": {
    binary: "qemu-img",
    aliases: [],
    required: true,
    description: "QEMU disk image utility used to create qcow2/raw images.",
  },
  xorriso: {
    binary: "xorriso",
    aliases: [],
    required: true,
    description: "ISO image utility used to prepare reusable installer media.",
  },
  sudo: {
    binary: "sudo",
    aliases: [],
    required: false,
    description: "Privilege escalation helper used for non-root pacman mutations.",
  },
} as const;

const DEFAULT_QEMU_MANIFEST_CONFIG = {
  architecture: "x86_64",
  machine: "q35",
  accelerator: "kvm",
  memoryMb: 2048,
  useProxy: false,
  autoBootstrapRouterOnLaunch: false,
  bootstrapUsername: "root",
  bootstrapPassword: "opnsense",
  systemDependencyId: "qemu-system",
  imageDependencyId: "qemu-img",
  proxyDependencyId: "proxychains",
  defaultArgs: [] as string[],
} as const;

type RawManifestDependencyConfig = {
  binary?: unknown;
  aliases?: unknown;
  required?: unknown;
  description?: unknown;
};

type RawQemuKitManifestConfig = {
  architecture?: unknown;
  machine?: unknown;
  accelerator?: unknown;
  memoryMb?: unknown;
  useProxy?: unknown;
  autoBootstrapRouterOnLaunch?: unknown;
  bootstrapUsername?: unknown;
  bootstrapPassword?: unknown;
  systemDependencyId?: unknown;
  imageDependencyId?: unknown;
  proxyDependencyId?: unknown;
  defaultArgs?: unknown;
};

type RawManifestConfig = {
  dependencies?: Record<string, RawManifestDependencyConfig>;
  kits?: {
    qemu?: RawQemuKitManifestConfig;
  };
};

type RawRootConfig = {
  manifest?: RawManifestConfig;
};

export type ManifestDependencyConfig = {
  id: string;
  binary: string;
  aliases: readonly string[];
  required: boolean;
  description?: string;
};

export type ManifestDependencyStatus = ManifestDependencyConfig & {
  available: boolean;
  resolvedBinary: string | null;
  resolvedPath: string | null;
};

export type ResolvedQemuManifestConfig = {
  architecture: string;
  machine: string;
  accelerator?: string;
  memoryMb: number;
  useProxy: boolean;
  autoBootstrapRouterOnLaunch: boolean;
  bootstrapUsername: string;
  bootstrapPassword: string;
  systemDependencyId: string;
  imageDependencyId: string;
  proxyDependencyId: string;
  defaultArgs: readonly string[];
};

type ResolvedManifestConfig = {
  dependencies: Record<string, ManifestDependencyConfig>;
  kits: {
    qemu: ResolvedQemuManifestConfig;
  };
};

type ResolvedExecutable = {
  resolvedBinary: string;
  resolvedPath: string;
};

function normalizeString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStringList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`);
  }

  const values = value
    .map((entry, index) => normalizeString(entry, `${label}[${index}]`))
    .filter((entry): entry is string => Boolean(entry));
  return [...new Set(values)];
}

function normalizeBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  throw new Error(`${label} must be a boolean.`);
}

function normalizePositiveInteger(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return numericValue;
}

function resolveCandidateExecutable(candidate: string): string | null {
  const normalizedCandidate = candidate.trim();
  if (normalizedCandidate.length === 0) {
    return null;
  }

  if (normalizedCandidate.includes("/")) {
    const resolvedPath = isAbsolute(normalizedCandidate)
      ? normalizedCandidate
      : resolve(process.cwd(), normalizedCandidate);
    return isExecutableFile(resolvedPath) ? resolvedPath : null;
  }

  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const pathEntry of pathEntries) {
    const resolvedPath = resolve(pathEntry, normalizedCandidate);
    if (isExecutableFile(resolvedPath)) {
      return resolvedPath;
    }
  }

  return null;
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutable(
  binary: string,
  aliases: readonly string[],
): ResolvedExecutable | null {
  const candidates = [...new Set([binary, ...aliases])];
  for (const candidate of candidates) {
    const resolvedPath = resolveCandidateExecutable(candidate);
    if (resolvedPath) {
      return {
        resolvedBinary: candidate,
        resolvedPath,
      };
    }
  }

  return null;
}

function resolveDependencyConfig(
  id: string,
  rawDependency: RawManifestDependencyConfig | undefined,
): ManifestDependencyConfig {
  const defaultDependency =
    DEFAULT_MANIFEST_DEPENDENCIES[
      id as keyof typeof DEFAULT_MANIFEST_DEPENDENCIES
    ];
  const binary =
    normalizeString(
      rawDependency?.binary,
      `manifest.dependencies.${id}.binary`,
    ) ??
    defaultDependency?.binary ??
    id;
  const aliases = [
    ...(defaultDependency?.aliases ?? []),
    ...normalizeStringList(
      rawDependency?.aliases,
      `manifest.dependencies.${id}.aliases`,
    ),
  ].filter((alias) => alias !== binary);

  return {
    id,
    binary,
    aliases: [...new Set(aliases)],
    required:
      normalizeBoolean(
        rawDependency?.required,
        `manifest.dependencies.${id}.required`,
      ) ??
      defaultDependency?.required ??
      false,
    description:
      normalizeString(
        rawDependency?.description,
        `manifest.dependencies.${id}.description`,
      ) ?? defaultDependency?.description,
  };
}

function assertDependencyReference(
  dependencies: Record<string, ManifestDependencyConfig>,
  dependencyId: string,
  label: string,
): void {
  if (!dependencies[dependencyId]) {
    throw new Error(
      `${label} references unknown dependency '${dependencyId}'.`,
    );
  }
}

function resolveManifestConfig(
  rawManifestConfig: RawManifestConfig | undefined,
): ResolvedManifestConfig {
  const rawDependencies = rawManifestConfig?.dependencies ?? {};
  const dependencyIds = new Set<string>([
    ...Object.keys(DEFAULT_MANIFEST_DEPENDENCIES),
    ...Object.keys(rawDependencies),
  ]);
  const dependencies = Object.fromEntries(
    [...dependencyIds]
      .sort((left, right) => left.localeCompare(right))
      .map((id) => [id, resolveDependencyConfig(id, rawDependencies[id])]),
  ) as Record<string, ManifestDependencyConfig>;

  const rawQemu = rawManifestConfig?.kits?.qemu;
  const qemuConfig: ResolvedQemuManifestConfig = {
    architecture:
      normalizeString(
        rawQemu?.architecture,
        "manifest.kits.qemu.architecture",
      ) ?? DEFAULT_QEMU_MANIFEST_CONFIG.architecture,
    machine:
      normalizeString(rawQemu?.machine, "manifest.kits.qemu.machine") ??
      DEFAULT_QEMU_MANIFEST_CONFIG.machine,
    accelerator:
      normalizeString(rawQemu?.accelerator, "manifest.kits.qemu.accelerator") ??
      DEFAULT_QEMU_MANIFEST_CONFIG.accelerator,
    memoryMb:
      normalizePositiveInteger(
        rawQemu?.memoryMb,
        "manifest.kits.qemu.memoryMb",
      ) ?? DEFAULT_QEMU_MANIFEST_CONFIG.memoryMb,
    useProxy:
      normalizeBoolean(rawQemu?.useProxy, "manifest.kits.qemu.useProxy") ??
      DEFAULT_QEMU_MANIFEST_CONFIG.useProxy,
    autoBootstrapRouterOnLaunch:
      normalizeBoolean(
        rawQemu?.autoBootstrapRouterOnLaunch,
        "manifest.kits.qemu.autoBootstrapRouterOnLaunch",
      ) ?? DEFAULT_QEMU_MANIFEST_CONFIG.autoBootstrapRouterOnLaunch,
    bootstrapUsername:
      normalizeString(
        rawQemu?.bootstrapUsername,
        "manifest.kits.qemu.bootstrapUsername",
      ) ?? DEFAULT_QEMU_MANIFEST_CONFIG.bootstrapUsername,
    bootstrapPassword:
      normalizeString(
        rawQemu?.bootstrapPassword,
        "manifest.kits.qemu.bootstrapPassword",
      ) ?? DEFAULT_QEMU_MANIFEST_CONFIG.bootstrapPassword,
    systemDependencyId:
      normalizeString(
        rawQemu?.systemDependencyId,
        "manifest.kits.qemu.systemDependencyId",
      ) ?? DEFAULT_QEMU_MANIFEST_CONFIG.systemDependencyId,
    imageDependencyId:
      normalizeString(
        rawQemu?.imageDependencyId,
        "manifest.kits.qemu.imageDependencyId",
      ) ?? DEFAULT_QEMU_MANIFEST_CONFIG.imageDependencyId,
    proxyDependencyId:
      normalizeString(
        rawQemu?.proxyDependencyId,
        "manifest.kits.qemu.proxyDependencyId",
      ) ?? DEFAULT_QEMU_MANIFEST_CONFIG.proxyDependencyId,
    defaultArgs:
      normalizeStringList(
        rawQemu?.defaultArgs,
        "manifest.kits.qemu.defaultArgs",
      ).length > 0
        ? normalizeStringList(
            rawQemu?.defaultArgs,
            "manifest.kits.qemu.defaultArgs",
          )
        : [...DEFAULT_QEMU_MANIFEST_CONFIG.defaultArgs],
  };

  assertDependencyReference(
    dependencies,
    qemuConfig.systemDependencyId,
    "manifest.kits.qemu.systemDependencyId",
  );
  assertDependencyReference(
    dependencies,
    qemuConfig.imageDependencyId,
    "manifest.kits.qemu.imageDependencyId",
  );
  assertDependencyReference(
    dependencies,
    qemuConfig.proxyDependencyId,
    "manifest.kits.qemu.proxyDependencyId",
  );

  return {
    dependencies,
    kits: {
      qemu: qemuConfig,
    },
  };
}

export class Manifest {
  private readonly config: ResolvedManifestConfig;
  private readonly dependencyStatus = new Map<
    string,
    ManifestDependencyStatus
  >();

  constructor(config: ResolvedManifestConfig) {
    this.config = config;
    this.refreshAll();
  }

  listDependencies(): ManifestDependencyStatus[] {
    return [...this.dependencyStatus.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }

  getDependency(id: string): ManifestDependencyStatus | null {
    return this.dependencyStatus.get(id) ?? null;
  }

  requireDependency(id: string): ManifestDependencyStatus {
    const dependency = this.getDependency(id);
    if (!dependency) {
      throw new Error(`Unknown manifest dependency '${id}'.`);
    }

    return dependency;
  }

  refreshDependency(id: string): ManifestDependencyStatus {
    const dependency = this.config.dependencies[id];
    if (!dependency) {
      throw new Error(`Unknown manifest dependency '${id}'.`);
    }

    const resolvedExecutable = resolveExecutable(
      dependency.binary,
      dependency.aliases,
    );
    const status: ManifestDependencyStatus = {
      ...dependency,
      available: resolvedExecutable !== null,
      resolvedBinary: resolvedExecutable?.resolvedBinary ?? null,
      resolvedPath: resolvedExecutable?.resolvedPath ?? null,
    };

    this.dependencyStatus.set(id, status);
    return status;
  }

  refreshAll(): ManifestDependencyStatus[] {
    for (const id of Object.keys(this.config.dependencies)) {
      this.refreshDependency(id);
    }

    return this.listDependencies();
  }

  getMissingDependencies(requiredOnly = false): ManifestDependencyStatus[] {
    return this.refreshAll().filter(
      (dependency) =>
        !dependency.available && (!requiredOnly || dependency.required),
    );
  }

  validateRequiredDependencies(): ManifestDependencyStatus[] {
    const missingDependencies = this.getMissingDependencies(true);
    if (missingDependencies.length > 0) {
      const dependencyList = missingDependencies
        .map((dependency) => dependency.id)
        .join(", ");
      throw new Error(
        `Required manifest dependencies are missing: ${dependencyList}.`,
      );
    }

    return this.listDependencies().filter((dependency) => dependency.required);
  }

  assertDependency(id: string, reason?: string): ManifestDependencyStatus {
    const dependency = this.refreshDependency(id);
    if (dependency.available) {
      return dependency;
    }

    const attemptedBinaries = [dependency.binary, ...dependency.aliases].join(
      ", ",
    );
    const prefix = reason ? `${reason}. ` : "";
    throw new Error(
      `${prefix}Required dependency '${dependency.id}' is not available. ` +
        `Checked: ${attemptedBinaries}. Update ${CONFIG_PATH} manifest.dependencies.${dependency.id}.binary or install the binary in PATH.`,
    );
  }

  isDependencyAvailable(id: string): boolean {
    return this.refreshDependency(id).available;
  }

  getQemuConfig(): ResolvedQemuManifestConfig {
    return {
      ...this.config.kits.qemu,
      defaultArgs: [...this.config.kits.qemu.defaultArgs],
    };
  }

  resolveDependencyCommand(id: string, reason?: string): string {
    const dependency = this.assertDependency(id, reason);
    return (
      dependency.resolvedPath ?? dependency.resolvedBinary ?? dependency.binary
    );
  }

  toJSON(): ResolvedManifestConfig & {
    dependencyStatus: ManifestDependencyStatus[];
  } {
    return {
      ...this.config,
      dependencyStatus: this.listDependencies(),
    };
  }
}

class ManifestLoader {
  static async loadManifest(): Promise<Manifest> {
    const configContent = await file(resolveCwdOrRuntimeFilePath(CONFIG_PATH)).text();
    const configData = YAML.parse(configContent) as RawRootConfig;
    return new Manifest(resolveManifestConfig(configData.manifest));
  }
}

export const $manifest: Manifest = await ManifestLoader.loadManifest();
