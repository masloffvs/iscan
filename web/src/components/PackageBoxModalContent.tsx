import { useEffect, useMemo, useState, type ReactNode } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { json } from "@codemirror/lang-json";
import { githubDarkInit } from "@uiw/codemirror-theme-github";
import PackageBoxTerminal from "./PackageBoxTerminal";
import type {
  RemotePackagePrivilegeLevel,
  RemotePackageSandboxBindMount,
  RemotePackageSandboxBindMountMode,
  RemotePackageSandboxDevMode,
  RemotePackageSandboxPolicyExtensions,
  RemotePackageSandboxProcMode,
  RemotePackageSandboxSysMode,
  RemoteSupportedPackageEntry,
} from "../api/client";
import { useInterfaceStore, type PackageBoxModalTab } from "../store/ui";

const EMPTY_PACKAGE_IDS: readonly string[] = [];
const PACKAGE_PRIVILEGE_LEVELS: readonly RemotePackagePrivilegeLevel[] = ["sandbox-ro", "sandbox-rw", "host-privileged"];
const PACKAGE_SANDBOX_SYS_MODES: readonly RemotePackageSandboxSysMode[] = ["off", "host-ro", "host-rw", "sysfs"];
const PACKAGE_SANDBOX_DEV_MODES: readonly RemotePackageSandboxDevMode[] = ["sandbox", "host"];
const PACKAGE_SANDBOX_PROC_MODES: readonly RemotePackageSandboxProcMode[] = ["sandbox", "host-ro", "host-rw"];
const PACKAGE_SANDBOX_BIND_MOUNT_MODES: readonly RemotePackageSandboxBindMountMode[] = ["ro-bind", "bind", "dev-bind"];
const DEFAULT_SANDBOX_POLICY_EXTENSIONS: Readonly<RemotePackageSandboxPolicyExtensions> = {
  devMode: "sandbox",
  extraBindMounts: [],
  procMode: "sandbox",
  shareNetwork: true,
  sysMode: "off",
};
const POLICY_EDITOR_THEME = githubDarkInit({
  settings: {
    background: "transparent",
    gutterBackground: "transparent",
    caret: "#c6c6c6",
    fontFamily: "monospace",
  },
});
const POLICY_EDITOR_BASIC_SETUP = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  completionKeymap: true,
} as const;

type PolicyValidationIssue = {
  severity: "error" | "warning";
  message: string;
};

type PackageBoxPolicyDraft = {
  allowedPrivilegeLevels: RemotePackagePrivilegeLevel[];
  defaultPrivilegeLevel: RemotePackagePrivilegeLevel;
  sandboxPolicyExtensions: RemotePackageSandboxPolicyExtensions;
};

type PolicyValidationResult = {
  issues: PolicyValidationIssue[];
  parsedPolicy: PackageBoxPolicyDraft | null;
};

type PolicyPresetDefinition = {
  description: string;
  id: string;
  patch: Partial<RemotePackageSandboxPolicyExtensions>;
  title: string;
};

type BoxPresetDefinition = {
  description: string;
  id: string;
  packageIds: string[];
  title: string;
};

type TableColumn = {
  className?: string;
  key: string;
  label: string;
};

function packageDependencySummary(packageEntry: RemoteSupportedPackageEntry): string {
  const pacman = packageEntry.dependency.pacman.join(", ");
  const paru = packageEntry.dependency.paru.join(", ");
  if (pacman && paru) {
    return `pacman: ${pacman} · paru: ${paru}`;
  }

  if (pacman) {
    return `pacman: ${pacman}`;
  }

  if (paru) {
    return `paru: ${paru}`;
  }

  return "No declarative dependencies.";
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "-";
  }

  return new Date(timestamp).toLocaleString();
}

function summarizeBoxError(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function orderPrivilegeLevels(levels: readonly RemotePackagePrivilegeLevel[]): RemotePackagePrivilegeLevel[] {
  const levelSet = new Set(levels);
  return PACKAGE_PRIVILEGE_LEVELS.filter((level) => levelSet.has(level));
}

function formatPrivilegeLevel(level: RemotePackagePrivilegeLevel): string {
  switch (level) {
    case "sandbox-ro":
      return "Sandbox RO";
    case "sandbox-rw":
      return "Sandbox RW";
    case "host-privileged":
      return "Host Privileged";
    default:
      return level;
  }
}

function formatAllowedPrivilegeLevels(levels: readonly RemotePackagePrivilegeLevel[]): string {
  if (levels.length === 0) {
    return "-";
  }

  return orderPrivilegeLevels(levels).map((level) => formatPrivilegeLevel(level)).join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createDefaultSandboxPolicyExtensions(): RemotePackageSandboxPolicyExtensions {
  return {
    devMode: DEFAULT_SANDBOX_POLICY_EXTENSIONS.devMode,
    extraBindMounts: [],
    procMode: DEFAULT_SANDBOX_POLICY_EXTENSIONS.procMode,
    shareNetwork: DEFAULT_SANDBOX_POLICY_EXTENSIONS.shareNetwork,
    sysMode: DEFAULT_SANDBOX_POLICY_EXTENSIONS.sysMode,
  };
}

function cloneSandboxPolicyExtensions(value: RemotePackageSandboxPolicyExtensions): RemotePackageSandboxPolicyExtensions {
  return {
    devMode: value.devMode,
    extraBindMounts: value.extraBindMounts.map((entry) => ({ ...entry })),
    procMode: value.procMode,
    shareNetwork: value.shareNetwork,
    sysMode: value.sysMode,
  };
}

function formatSandboxSysMode(mode: RemotePackageSandboxSysMode): string {
  switch (mode) {
    case "off":
      return "No /sys mount";
    case "host-ro":
      return "Host /sys RO";
    case "host-rw":
      return "Host /sys RW";
    case "sysfs":
      return "Fresh sysfs (if supported)";
    default:
      return mode;
  }
}

function formatSandboxDevMode(mode: RemotePackageSandboxDevMode): string {
  switch (mode) {
    case "sandbox":
      return "Sandbox /dev";
    case "host":
      return "Host /dev";
    default:
      return mode;
  }
}

function formatSandboxProcMode(mode: RemotePackageSandboxProcMode): string {
  switch (mode) {
    case "sandbox":
      return "Sandbox /proc";
    case "host-ro":
      return "Host /proc RO";
    case "host-rw":
      return "Host /proc RW";
    default:
      return mode;
  }
}

function formatSandboxBindMountMode(mode: RemotePackageSandboxBindMountMode): string {
  switch (mode) {
    case "ro-bind":
      return "RO bind";
    case "bind":
      return "RW bind";
    case "dev-bind":
      return "Device bind";
    default:
      return mode;
  }
}

function formatSandboxBindMount(entry: RemotePackageSandboxBindMount): string {
  return `${formatSandboxBindMountMode(entry.mode)} ${entry.source} -> ${entry.target}`;
}

function formatSandboxPolicySummary(value: RemotePackageSandboxPolicyExtensions): string {
  const parts = [
    `sys: ${value.sysMode === "off" ? "off" : formatSandboxSysMode(value.sysMode)}`,
    `dev: ${value.devMode === "sandbox" ? "sandbox" : "host"}`,
    `proc: ${value.procMode === "sandbox" ? "sandbox" : formatSandboxProcMode(value.procMode)}`,
    value.shareNetwork ? "net: shared" : "net: private",
  ];

  if (value.extraBindMounts.length > 0) {
    parts.push(`binds: ${value.extraBindMounts.length}`);
  }

  return parts.join(" · ");
}

function parseEnumValue<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== "string") {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }

  if (!allowed.includes(value as T)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }

  return value as T;
}

function parseAbsolutePolicyPath(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty absolute path.`);
  }

  const normalized = value.trim();
  if (!normalized.startsWith("/")) {
    throw new Error(`${label} must be a non-empty absolute path.`);
  }

  return normalized;
}

function parseSandboxBindMount(value: unknown, label: string): RemotePackageSandboxBindMount {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return {
    mode: value.mode === undefined ? "ro-bind" : parseEnumValue(value.mode, `${label}.mode`, PACKAGE_SANDBOX_BIND_MOUNT_MODES),
    source: parseAbsolutePolicyPath(value.source, `${label}.source`),
    target: parseAbsolutePolicyPath(value.target, `${label}.target`),
  };
}

function parseSandboxPolicyExtensions(value: unknown): RemotePackageSandboxPolicyExtensions {
  if (value === undefined || value === null) {
    return createDefaultSandboxPolicyExtensions();
  }

  if (!isRecord(value)) {
    throw new Error("sandboxPolicyExtensions must be an object.");
  }

  const extraBindMounts = (() => {
    if (value.extraBindMounts === undefined || value.extraBindMounts === null) {
      return [];
    }

    if (!Array.isArray(value.extraBindMounts)) {
      throw new Error("sandboxPolicyExtensions.extraBindMounts must be an array.");
    }

    return value.extraBindMounts.map((entry, index) => parseSandboxBindMount(entry, `sandboxPolicyExtensions.extraBindMounts[${index}]`));
  })();

  const shareNetwork = (() => {
    if (value.shareNetwork === undefined) {
      return DEFAULT_SANDBOX_POLICY_EXTENSIONS.shareNetwork;
    }

    if (typeof value.shareNetwork !== "boolean") {
      throw new Error("sandboxPolicyExtensions.shareNetwork must be a boolean.");
    }

    return value.shareNetwork;
  })();

  return {
    devMode: value.devMode === undefined ? DEFAULT_SANDBOX_POLICY_EXTENSIONS.devMode : parseEnumValue(value.devMode, "sandboxPolicyExtensions.devMode", PACKAGE_SANDBOX_DEV_MODES),
    extraBindMounts,
    procMode: value.procMode === undefined ? DEFAULT_SANDBOX_POLICY_EXTENSIONS.procMode : parseEnumValue(value.procMode, "sandboxPolicyExtensions.procMode", PACKAGE_SANDBOX_PROC_MODES),
    shareNetwork,
    sysMode: value.sysMode === undefined ? DEFAULT_SANDBOX_POLICY_EXTENSIONS.sysMode : parseEnumValue(value.sysMode, "sandboxPolicyExtensions.sysMode", PACKAGE_SANDBOX_SYS_MODES),
  };
}

function formatPolicyJson(
  defaultPrivilegeLevel: RemotePackagePrivilegeLevel,
  allowedPrivilegeLevels: readonly RemotePackagePrivilegeLevel[],
  sandboxPolicyExtensions: RemotePackageSandboxPolicyExtensions = createDefaultSandboxPolicyExtensions(),
): string {
  return JSON.stringify({
    allowedPrivilegeLevels: orderPrivilegeLevels(allowedPrivilegeLevels),
    defaultPrivilegeLevel,
    sandboxPolicyExtensions: {
      devMode: sandboxPolicyExtensions.devMode,
      extraBindMounts: sandboxPolicyExtensions.extraBindMounts.map((entry) => ({ ...entry })),
      procMode: sandboxPolicyExtensions.procMode,
      shareNetwork: sandboxPolicyExtensions.shareNetwork,
      sysMode: sandboxPolicyExtensions.sysMode,
    },
  }, null, 2);
}

function parseRawPolicyJson(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

function parsePolicyJsonValue(value: unknown): PackageBoxPolicyDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Policy JSON must be an object.");
  }

  const candidate = value as {
    defaultPrivilegeLevel?: unknown;
    allowedPrivilegeLevels?: unknown;
    sandboxPolicyExtensions?: unknown;
  };
  if (typeof candidate.defaultPrivilegeLevel !== "string" || !PACKAGE_PRIVILEGE_LEVELS.includes(candidate.defaultPrivilegeLevel as RemotePackagePrivilegeLevel)) {
    throw new Error(`defaultPrivilegeLevel must be one of: ${PACKAGE_PRIVILEGE_LEVELS.join(", ")}.`);
  }

  if (!Array.isArray(candidate.allowedPrivilegeLevels)) {
    throw new Error("allowedPrivilegeLevels must be an array.");
  }

  const allowedPrivilegeLevels = candidate.allowedPrivilegeLevels.map((entry, index) => {
    if (typeof entry !== "string" || !PACKAGE_PRIVILEGE_LEVELS.includes(entry as RemotePackagePrivilegeLevel)) {
      throw new Error(`allowedPrivilegeLevels[${index}] must be one of: ${PACKAGE_PRIVILEGE_LEVELS.join(", ")}.`);
    }

    return entry as RemotePackagePrivilegeLevel;
  });
  const orderedAllowedPrivilegeLevels = orderPrivilegeLevels(allowedPrivilegeLevels);
  const defaultPrivilegeLevel = candidate.defaultPrivilegeLevel as RemotePackagePrivilegeLevel;
  if (!orderedAllowedPrivilegeLevels.includes(defaultPrivilegeLevel)) {
    throw new Error("allowedPrivilegeLevels must include defaultPrivilegeLevel.");
  }

  return {
    allowedPrivilegeLevels: orderedAllowedPrivilegeLevels,
    defaultPrivilegeLevel,
    sandboxPolicyExtensions: parseSandboxPolicyExtensions(candidate.sandboxPolicyExtensions),
  };
}

function describeHostPrivilegedConstraint(): string {
  return "host-privileged requires an Arch-compatible host plus systemd-nspawn and either root or sudo access.";
}

function validatePolicySource(
  source: string,
  hostInfo: ReturnType<typeof useInterfaceStore.getState>["packageHostInfo"],
): PolicyValidationResult {
  const issues: PolicyValidationIssue[] = [];
  let parsed: unknown;

  try {
    parsed = parseRawPolicyJson(source);
  } catch (error) {
    return {
      issues: [{ severity: "error", message: error instanceof Error ? error.message : String(error) }],
      parsedPolicy: null,
    };
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const candidate = parsed as Record<string, unknown>;
    const unknownKeys = Object.keys(candidate).filter((key) => key !== "allowedPrivilegeLevels" && key !== "defaultPrivilegeLevel" && key !== "sandboxPolicyExtensions");
    if (unknownKeys.length > 0) {
      issues.push({
        severity: "warning",
        message: `Unknown key(s) will be ignored by the policy editor: ${unknownKeys.join(", ")}.`,
      });
    }

    if (Array.isArray(candidate.allowedPrivilegeLevels)) {
      const duplicates = candidate.allowedPrivilegeLevels
        .filter((entry): entry is string => typeof entry === "string")
        .filter((entry, index, entries) => entries.indexOf(entry) !== index);
      if (duplicates.length > 0) {
        issues.push({
          severity: "warning",
          message: `Duplicate allowedPrivilegeLevels will be normalized away: ${[...new Set(duplicates)].join(", ")}.`,
        });
      }
    }

    if (candidate.sandboxPolicyExtensions && isRecord(candidate.sandboxPolicyExtensions)) {
      const unknownSandboxKeys = Object.keys(candidate.sandboxPolicyExtensions)
        .filter((key) => key !== "devMode" && key !== "extraBindMounts" && key !== "procMode" && key !== "shareNetwork" && key !== "sysMode");
      if (unknownSandboxKeys.length > 0) {
        issues.push({
          severity: "warning",
          message: `Unknown sandboxPolicyExtensions key(s) will be ignored: ${unknownSandboxKeys.join(", ")}.`,
        });
      }

      if (Array.isArray(candidate.sandboxPolicyExtensions.extraBindMounts)) {
        candidate.sandboxPolicyExtensions.extraBindMounts.forEach((entry, index) => {
          if (!isRecord(entry)) {
            return;
          }

          const unknownBindKeys = Object.keys(entry).filter((key) => key !== "mode" && key !== "source" && key !== "target");
          if (unknownBindKeys.length > 0) {
            issues.push({
              severity: "warning",
              message: `Unknown extraBindMounts[${index}] key(s) will be ignored: ${unknownBindKeys.join(", ")}.`,
            });
          }
        });
      }
    }
  }

  let parsedPolicy: PolicyValidationResult["parsedPolicy"] = null;
  try {
    parsedPolicy = parsePolicyJsonValue(parsed);
  } catch (error) {
    issues.push({ severity: "error", message: error instanceof Error ? error.message : String(error) });
    return { issues, parsedPolicy: null };
  }

  if (!parsedPolicy.allowedPrivilegeLevels.includes("sandbox-ro")) {
    issues.push({
      severity: "warning",
      message: "sandbox-ro is not available as a fallback in allowedPrivilegeLevels.",
    });
  }

  if (!parsedPolicy.sandboxPolicyExtensions.shareNetwork) {
    issues.push({
      severity: "warning",
      message: "shareNetwork=false keeps the box on a private network namespace; package downloads and scanners may stop seeing the host network.",
    });
  }

  if (parsedPolicy.sandboxPolicyExtensions.sysMode === "host-rw") {
    issues.push({
      severity: "warning",
      message: "sysMode=host-rw exposes the host /sys tree as writable inside sandbox runs.",
    });
  }

  if (parsedPolicy.sandboxPolicyExtensions.procMode === "host-rw") {
    issues.push({
      severity: "warning",
      message: "procMode=host-rw exposes the host /proc tree as writable inside sandbox runs.",
    });
  }

  const writableBindMounts = parsedPolicy.sandboxPolicyExtensions.extraBindMounts.filter((entry) => entry.mode !== "ro-bind");
  if (writableBindMounts.length > 0) {
    issues.push({
      severity: "warning",
      message: `Writable bind mounts are enabled: ${writableBindMounts.map((entry) => `${entry.source} (${entry.mode})`).join(", ")}.`,
    });
  }

  if (parsedPolicy.allowedPrivilegeLevels.includes("host-privileged") || parsedPolicy.defaultPrivilegeLevel === "host-privileged") {
    if (hostInfo) {
      if (!hostInfo.archCompatible) {
        issues.push({ severity: "error", message: `This host cannot run host-privileged boxes. ${describeHostPrivilegedConstraint()}` });
      }
      if (!hostInfo.nspawnExecutable) {
        issues.push({ severity: "error", message: "host-privileged requires systemd-nspawn, but it is not available on this host." });
      }
      if (!hostInfo.isRoot && !hostInfo.sudoExecutable) {
        issues.push({ severity: "error", message: "host-privileged requires root or sudo on this host, but neither is available." });
      }
    }
  }

  return {
    issues,
    parsedPolicy,
  };
}

const POLICY_TEMPLATE_COMPLETION: Completion = {
  label: "policy template",
  type: "keyword",
  apply: `{
  "allowedPrivilegeLevels": ["sandbox-ro", "sandbox-rw"],
  "defaultPrivilegeLevel": "sandbox-ro",
  "sandboxPolicyExtensions": {
    "sysMode": "off",
    "devMode": "sandbox",
    "procMode": "sandbox",
    "shareNetwork": true,
    "extraBindMounts": []
  }
}`,
  detail: "Insert a starter policy object",
};

function createEnumValueCompletions<T extends string>(
  values: readonly T[],
  inStringContext: boolean,
  describe: (value: T) => string,
): Completion[] {
  return values.map((value) => ({
    label: value,
    type: "enum",
    apply: inStringContext ? `${value}\"` : `"${value}"`,
    detail: describe(value),
  }));
}

function createBooleanValueCompletions(): Completion[] {
  return [
    { label: "true", type: "constant", apply: "true", detail: "Enable the option" },
    { label: "false", type: "constant", apply: "false", detail: "Disable the option" },
  ];
}

function createPolicyKeyCompletions(scope: "root" | "sandbox" | "bind", inStringContext: boolean): Completion[] {
  if (scope === "sandbox") {
    return [
      {
        label: "sysMode",
        type: "property",
        apply: inStringContext ? "sysMode\"" : '"sysMode": "off"',
        detail: "How /sys is exposed inside bwrap",
      },
      {
        label: "devMode",
        type: "property",
        apply: inStringContext ? "devMode\"" : '"devMode": "sandbox"',
        detail: "Whether /dev stays synthetic or binds host /dev",
      },
      {
        label: "procMode",
        type: "property",
        apply: inStringContext ? "procMode\"" : '"procMode": "sandbox"',
        detail: "How /proc is exposed inside bwrap",
      },
      {
        label: "shareNetwork",
        type: "property",
        apply: inStringContext ? "shareNetwork\"" : '"shareNetwork": true',
        detail: "Share or isolate the host network namespace",
      },
      {
        label: "extraBindMounts",
        type: "property",
        apply: inStringContext ? "extraBindMounts\"" : '"extraBindMounts": []',
        detail: "Additional bind mounts appended to the bwrap command",
      },
    ];
  }

  if (scope === "bind") {
    return [
      {
        label: "source",
        type: "property",
        apply: inStringContext ? "source\"" : '"source": "/sys"',
        detail: "Host path to bind",
      },
      {
        label: "target",
        type: "property",
        apply: inStringContext ? "target\"" : '"target": "/sys"',
        detail: "Path inside the box",
      },
      {
        label: "mode",
        type: "property",
        apply: inStringContext ? "mode\"" : '"mode": "ro-bind"',
        detail: "bwrap bind flag for this mount",
      },
    ];
  }

  return [
    {
      label: "allowedPrivilegeLevels",
      type: "property",
      apply: inStringContext ? "allowedPrivilegeLevels\"" : '"allowedPrivilegeLevels": ["sandbox-ro", "sandbox-rw"]',
      detail: "Allowed privilege overrides",
    },
    {
      label: "defaultPrivilegeLevel",
      type: "property",
      apply: inStringContext ? "defaultPrivilegeLevel\"" : '"defaultPrivilegeLevel": "sandbox-ro"',
      detail: "Default privilege level",
    },
    {
      label: "sandboxPolicyExtensions",
      type: "property",
      apply: inStringContext ? "sandboxPolicyExtensions\"" : '"sandboxPolicyExtensions": {\n  "sysMode": "off",\n  "devMode": "sandbox",\n  "procMode": "sandbox",\n  "shareNetwork": true,\n  "extraBindMounts": []\n}',
      detail: "Optional bwrap mount and namespace extensions",
    },
  ];
}

function createPolicyValueCompletions(
  kind: "privilege" | "sys" | "dev" | "proc" | "bindMode" | "boolean",
  inStringContext: boolean,
): Completion[] {
  switch (kind) {
    case "privilege":
      return createEnumValueCompletions(PACKAGE_PRIVILEGE_LEVELS, inStringContext, formatPrivilegeLevel);
    case "sys":
      return createEnumValueCompletions(PACKAGE_SANDBOX_SYS_MODES, inStringContext, formatSandboxSysMode);
    case "dev":
      return createEnumValueCompletions(PACKAGE_SANDBOX_DEV_MODES, inStringContext, formatSandboxDevMode);
    case "proc":
      return createEnumValueCompletions(PACKAGE_SANDBOX_PROC_MODES, inStringContext, formatSandboxProcMode);
    case "bindMode":
      return createEnumValueCompletions(PACKAGE_SANDBOX_BIND_MOUNT_MODES, inStringContext, formatSandboxBindMountMode);
    case "boolean":
      return createBooleanValueCompletions();
    default:
      return [];
  }
}

function createPolicyCompletionResult(from: number, to: number, options: readonly Completion[]): CompletionResult | null {
  if (options.length === 0) {
    return null;
  }

  return { from, to, options: [...options] };
}

function policyCompletionSource(context: CompletionContext): CompletionResult | null {
  const source = context.state.doc.toString();
  const prefix = source.slice(0, context.pos);

  const detectScope = (input: string): "root" | "sandbox" | "bind" => {
    if (/"extraBindMounts"\s*:\s*\[[\s\S]*\{[^{}]*$/u.test(input)) {
      return "bind";
    }

    if (/"sandboxPolicyExtensions"\s*:\s*\{[\s\S]*$/u.test(input)) {
      return "sandbox";
    }

    return "root";
  };

  const detectValueKind = (input: string): "privilege" | "sys" | "dev" | "proc" | "bindMode" | "boolean" | null => {
    if (/"defaultPrivilegeLevel"\s*:\s*$/u.test(input) || /"allowedPrivilegeLevels"\s*:\s*\[[^\]]*$/u.test(input)) {
      return "privilege";
    }

    if (/"sysMode"\s*:\s*$/u.test(input)) {
      return "sys";
    }

    if (/"devMode"\s*:\s*$/u.test(input)) {
      return "dev";
    }

    if (/"procMode"\s*:\s*$/u.test(input)) {
      return "proc";
    }

    if (/"mode"\s*:\s*$/u.test(input) && detectScope(input) === "bind") {
      return "bindMode";
    }

    if (/"shareNetwork"\s*:\s*$/u.test(input)) {
      return "boolean";
    }

    return null;
  };

  if (prefix.trim().length === 0) {
    return createPolicyCompletionResult(0, context.pos, [POLICY_TEMPLATE_COMPLETION, ...createPolicyKeyCompletions("root", false)]);
  }

  const openStringMatch = prefix.match(/"[^"\n\r]*$/u);
  if (openStringMatch) {
    const fragment = openStringMatch[0].slice(1);
    const beforeString = prefix.slice(0, prefix.length - openStringMatch[0].length);
    const from = context.pos - fragment.length;
    const valueKind = detectValueKind(beforeString);

    if (valueKind && valueKind !== "boolean") {
      return createPolicyCompletionResult(from, context.pos, createPolicyValueCompletions(valueKind, true));
    }

    if (/[{,]\s*$/u.test(beforeString)) {
      return createPolicyCompletionResult(from, context.pos, createPolicyKeyCompletions(detectScope(beforeString), true));
    }
  }

  if (context.explicit && (/[{,]\s*$/u.test(prefix) || /\{\s*$/u.test(prefix))) {
    return createPolicyCompletionResult(context.pos, context.pos, createPolicyKeyCompletions(detectScope(prefix), false));
  }

  const explicitValueKind = detectValueKind(prefix);
  if (context.explicit && explicitValueKind) {
    return createPolicyCompletionResult(context.pos, context.pos, createPolicyValueCompletions(explicitValueKind, false));
  }

  return null;
}

const POLICY_PRESETS: readonly PolicyPresetDefinition[] = [
  {
    id: "baseline",
    title: "Baseline",
    description: "Reset to the default bwrap sandbox: no /sys mount, sandbox /dev and /proc, shared network.",
    patch: createDefaultSandboxPolicyExtensions(),
  },
  {
    id: "sys-host-ro",
    title: "Host /sys RO",
    description: "Bind the host /sys tree read-only for hardware and interface inspection.",
    patch: { sysMode: "host-ro" },
  },
  {
    id: "sysfs",
    title: "Fresh sysfs (feature-gated)",
    description: "Use a fresh sysfs at /sys when the host bubblewrap supports it; older hosts fall back to host /sys read-only.",
    patch: { sysMode: "sysfs" },
  },
  {
    id: "kernel-introspection",
    title: "Kernel Probe",
    description: "Expose host /dev plus read-only /proc and /sys for tools that inspect kernel interfaces.",
    patch: { devMode: "host", procMode: "host-ro", sysMode: "host-ro" },
  },
  {
    id: "private-network",
    title: "Private Net",
    description: "Keep current mounts but stop sharing the host network namespace.",
    patch: { shareNetwork: false },
  },
  {
    id: "host-rw",
    title: "Host RW",
    description: "Expose writable host /proc and /sys with host /dev. High risk; use only on trusted boxes.",
    patch: { devMode: "host", procMode: "host-rw", sysMode: "host-rw" },
  },
  {
    id: "dbus-bridge",
    title: "D-Bus Bridge",
    description: "Add a read-only /run/dbus bind mount as a starting point for host bus access.",
    patch: {
      extraBindMounts: [{ mode: "ro-bind", source: "/run/dbus", target: "/run/dbus" }],
    },
  },
];

function createPresetDefinitions(supportedPackages: readonly RemoteSupportedPackageEntry[]): BoxPresetDefinition[] {
  const presets = supportedPackages.map((packageEntry) => ({
    description: packageEntry.description,
    id: packageEntry.id,
    packageIds: [packageEntry.id],
    title: packageEntry.package,
  }));

  if (supportedPackages.length > 1) {
    presets.unshift({
      description: "Install the currently registered supported tool surfaces into one box.",
      id: "stack-full",
      packageIds: supportedPackages.map((entry) => entry.id),
      title: "Full Stack",
    });
  }

  return presets;
}

function compareInstalledCounts(left: number, right: number): number {
  if (left !== right) {
    return right - left;
  }

  return 0;
}

function renderPackageList(packageIds: readonly string[], installedPackageIds: ReadonlySet<string>): ReactNode {
  return (
    <span>
      {packageIds.map((packageId, index) => {
        const isInstalled = installedPackageIds.has(packageId);
        return (
          <span key={packageId}>
            {index > 0 ? <span className="text-[#68686e]">, </span> : null}
            <span className={isInstalled ? "font-semibold text-white" : "font-normal text-[#8b8b95]"}>
              {packageId}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function CompactTable({
  columns,
  children,
}: {
  columns: readonly TableColumn[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[8px] bg-black/20">
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[#68686e]">
            {columns.map((column) => (
              <th key={column.key} className={`px-2.5 py-2 font-medium ${column.className ?? ""}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function CompactTableEmptyRow({
  colSpan,
  label,
}: {
  colSpan: number;
  label: string;
}) {
  return (
    <tr className="text-[11px] text-[#8b8b95]">
      <td colSpan={colSpan} className="px-2.5 py-3">
        {label}
      </td>
    </tr>
  );
}

function tableRowClassName(index: number): string {
  return index % 2 === 0 ? "bg-transparent" : "bg-white/[0.015]";
}

function ActionIconButton({
  active = false,
  ariaLabel,
  children,
  disabled = false,
  onClick,
}: {
  active?: boolean;
  ariaLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`flex h-7 w-7 items-center justify-center rounded-[10px] transition ${active ? "bg-emerald-400/12 text-emerald-100" : "bg-white/[0.05] text-[#a0a0a8] hover:bg-white/[0.08] hover:text-white"} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[10px] px-2 py-1 text-[10px] uppercase tracking-[0.18em] transition ${active ? "bg-white/[0.08] text-white" : "text-[#8f8f98] hover:bg-white/[0.04] hover:text-white"}`}
    >
      {label}
    </button>
  );
}

function StatusPill({ tone, value }: { tone: "default" | "error" | "success"; value: string }) {
  const className = tone === "error"
    ? "text-rose-200"
    : tone === "success"
      ? "text-emerald-200"
      : "text-[#d6d6db]";

  return <span className={`text-[10px] uppercase tracking-[0.16em] ${className}`}>{value}</span>;
}

function PackageBoxModalOverview() {
  const packageBoxes = useInterfaceStore((state) => state.packageBoxes);
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);
  const defaultPackageBoxId = useInterfaceStore((state) => state.defaultPackageBoxId);
  const packageActionKind = useInterfaceStore((state) => state.packageActionKind);
  const packageActionTarget = useInterfaceStore((state) => state.packageActionTarget);
  const deletePackageBox = useInterfaceStore((state) => state.deletePackageBox);
  const selectPackageBox = useInterfaceStore((state) => state.selectPackageBox);

  const box = useMemo(
    () => packageBoxes.find((entry) => entry.id === activePackageBoxId) ?? null,
    [activePackageBoxId, packageBoxes],
  );

  if (!box) {
    return (
      <div className="rounded-[10px] bg-white/[0.02] p-3 text-[11px] text-[#8b8b95]">
        Selected box is no longer available. Refresh the boxes list and open it again.
      </div>
    );
  }

  const isDefault = box.id === defaultPackageBoxId;
  const isDeleting = packageActionKind === "delete" && packageActionTarget === box.id;
  const isSelecting = packageActionKind === "select" && packageActionTarget === box.id;
  const statusTone: "default" | "error" | "success" = box.status === "error"
    ? "error"
    : box.status === "ready"
      ? "success"
      : "default";

  return (
    <div className="rounded-[10px] bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[14px] font-medium text-white">{box.name}</h4>
            <StatusPill tone={statusTone} value={box.status} />
            {isDefault ? <StatusPill tone="success" value="default" /> : null}
          </div>
          <p className="mt-1 text-[11px] text-[#72727c]">{box.id}</p>
        </div>

        <div className="flex items-center gap-2">
          <ActionIconButton
            ariaLabel={isDefault ? "Default box" : "Set as default box"}
            active={isDefault}
            disabled={isDefault || isSelecting || isDeleting}
            onClick={() => { void selectPackageBox(box.id); }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          </ActionIconButton>

          <ActionIconButton
            ariaLabel="Delete box"
            disabled={isDeleting}
            onClick={() => {
              const confirmed = window.confirm(
                `Delete box '${box.name}' (${box.id}) and all stored data? This cannot be undone.`,
              );
              if (!confirmed) {
                return;
              }

              void deletePackageBox(box.id);
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="m6 6 1 14h10l1-14" />
            </svg>
          </ActionIconButton>
        </div>
      </div>

      <div className="mt-3">
        <CompactTable
          columns={[
            { key: "field", label: "Field", className: "w-[26%]" },
            { key: "value", label: "Value", className: "w-[74%]" },
          ]}
        >
          {[
            { field: "Status", value: <StatusPill tone={statusTone} value={box.status} /> },
            { field: "Default", value: isDefault ? <StatusPill tone="success" value="default" /> : <span className="text-[#72727c]">No</span> },
            { field: "Privilege default", value: <span className="text-[#d6d6db]">{formatPrivilegeLevel(box.defaultPrivilegeLevel)}</span> },
            { field: "Allowed privileges", value: <span className="text-[#d6d6db]">{formatAllowedPrivilegeLevels(box.allowedPrivilegeLevels)}</span> },
            {
              field: "Sandbox policy",
              value: (
                <div className="space-y-1">
                  <p className="text-[#d6d6db]">{formatSandboxPolicySummary(box.sandboxPolicyExtensions)}</p>
                  {box.sandboxPolicyExtensions.extraBindMounts.length > 0 ? (
                    <div className="space-y-1 text-[10px] text-[#8b8b95]">
                      {box.sandboxPolicyExtensions.extraBindMounts.map((entry, index) => (
                        <p key={`${entry.source}-${entry.target}-${index}`}>{formatSandboxBindMount(entry)}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ),
            },
            { field: "Root", value: <span className="break-all font-mono text-[11px] text-[#d6d6db]">{box.rootPath}</span> },
            { field: "Created", value: <span className="text-[#d6d6db]">{formatTimestamp(box.createdAt)}</span> },
            { field: "Updated", value: <span className="text-[#d6d6db]">{formatTimestamp(box.updatedAt)}</span> },
            {
              field: "Last error",
              value: box.lastError ? (
                <div className="space-y-2">
                  <p className="text-[10px] text-rose-300">{summarizeBoxError(box.lastError)}</p>
                  <div className="max-h-40 overflow-auto rounded-[10px] bg-rose-400/8 px-3 py-2">
                    <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-rose-100">{box.lastError}</pre>
                  </div>
                </div>
              ) : <span className="text-[#72727c]">-</span>,
            },
          ].map((row, index) => (
            <tr key={row.field} className={`align-top text-[11px] ${tableRowClassName(index)}`}>
              <td className="px-2.5 py-2.5 text-[#8f8f98]">{row.field}</td>
              <td className="px-2.5 py-2.5">{row.value}</td>
            </tr>
          ))}
        </CompactTable>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-[10px] bg-rose-400/6 px-3 py-2.5">
        <p className="text-[10px] text-rose-100">Delete removes the box rootfs, the per-box home directory, and clears it from the registry.</p>
        <button
          type="button"
          disabled={isDeleting}
          onClick={() => {
            const confirmed = window.confirm(
              `Delete box '${box.name}' (${box.id}) and all stored data? This cannot be undone.`,
            );
            if (!confirmed) {
              return;
            }

            void deletePackageBox(box.id);
          }}
          className="rounded-[10px] bg-rose-400/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-rose-100 transition hover:bg-rose-400/22 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isDeleting ? "Deleting" : "Delete Box"}
        </button>
      </div>
    </div>
  );
}

function PackageBoxModalPolicy() {
  const packageBoxes = useInterfaceStore((state) => state.packageBoxes);
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);
  const packageActionKind = useInterfaceStore((state) => state.packageActionKind);
  const packageActionTarget = useInterfaceStore((state) => state.packageActionTarget);
  const packageHostInfo = useInterfaceStore((state) => state.packageHostInfo);
  const setPackageBoxPrivilege = useInterfaceStore((state) => state.setPackageBoxPrivilege);

  const box = useMemo(
    () => packageBoxes.find((entry) => entry.id === activePackageBoxId) ?? null,
    [activePackageBoxId, packageBoxes],
  );
  const [draftSource, setDraftSource] = useState<string>("");

  useEffect(() => {
    if (!box) {
      return;
    }

    setDraftSource(formatPolicyJson(box.defaultPrivilegeLevel, box.allowedPrivilegeLevels, box.sandboxPolicyExtensions));
  }, [box]);

  if (!box) {
    return null;
  }

  const isPrivilegeSaving = packageActionKind === "privilege" && packageActionTarget === box.id;
  const canonicalSource = formatPolicyJson(box.defaultPrivilegeLevel, box.allowedPrivilegeLevels, box.sandboxPolicyExtensions);
  const isDirty = draftSource.trim() !== canonicalSource.trim();
  const validation = useMemo(() => validatePolicySource(draftSource, packageHostInfo), [draftSource, packageHostInfo]);
  const validationErrors = validation.issues.filter((issue) => issue.severity === "error");
  const validationWarnings = validation.issues.filter((issue) => issue.severity === "warning");
  const policyEditorExtensions = useMemo<Extension[]>(() => [
    json(),
    autocompletion({
      activateOnTyping: true,
      override: [policyCompletionSource],
    }),
  ], []);

  const resetDraft = () => {
    setDraftSource(canonicalSource);
  };

  const currentPolicyBase: PackageBoxPolicyDraft = validation.parsedPolicy ?? {
    allowedPrivilegeLevels: [...box.allowedPrivilegeLevels],
    defaultPrivilegeLevel: box.defaultPrivilegeLevel,
    sandboxPolicyExtensions: cloneSandboxPolicyExtensions(box.sandboxPolicyExtensions),
  };

  const applyPreset = (preset: PolicyPresetDefinition) => {
    const nextSandboxPolicy: RemotePackageSandboxPolicyExtensions = {
      ...currentPolicyBase.sandboxPolicyExtensions,
      ...preset.patch,
      extraBindMounts: preset.patch.extraBindMounts
        ? preset.patch.extraBindMounts.map((entry) => ({ ...entry }))
        : currentPolicyBase.sandboxPolicyExtensions.extraBindMounts.map((entry) => ({ ...entry })),
    };

    setDraftSource(formatPolicyJson(currentPolicyBase.defaultPrivilegeLevel, currentPolicyBase.allowedPrivilegeLevels, nextSandboxPolicy));
  };

  const saveDraft = async () => {
    if (!validation.parsedPolicy || validationErrors.length > 0) {
      return;
    }

    await setPackageBoxPrivilege(box.id, validation.parsedPolicy);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-[10px] bg-white/[0.03] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[#68686e]">Policy</p>
            <p className="mt-1 text-[11px] text-[#8b8b95]">Edit privilege levels plus bwrap mount and namespace extensions as JSON.</p>
          </div>

          {isPrivilegeSaving ? <StatusPill tone="default" value="saving" /> : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {POLICY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => { applyPreset(preset); }}
              className="rounded-[999px] border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[#c8c8cf] transition hover:border-white/[0.16] hover:bg-white/[0.08] hover:text-white"
              title={preset.description}
            >
              {preset.title}
            </button>
          ))}
        </div>

        <p className="mt-2 text-[10px] text-[#72727c]">Presets merge into the current sandbox policy. Review host paths before saving.</p>

        <div className="mt-3 overflow-hidden rounded-[10px] bg-black/20">
          <CodeMirror
            className="[&_.cm-editor]:min-h-[260px] [&_.cm-editor]:rounded-[10px] [&_.cm-editor]:border-0 [&_.cm-editor]:bg-transparent [&_.cm-editor]:outline-none [&_.cm-focused]:outline-none [&_.cm-gutters]:rounded-l-[10px] [&_.cm-gutters]:border-0 [&_.cm-gutters]:bg-transparent [&_.cm-scroller]:min-h-[260px] [&_.cm-scroller]:rounded-[10px]"
            value={draftSource}
            theme={POLICY_EDITOR_THEME}
            onChange={setDraftSource}
            extensions={policyEditorExtensions}
            basicSetup={POLICY_EDITOR_BASIC_SETUP}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2 text-[10px] text-[#72727c]">
            <p>Required keys: <span className="font-mono text-[#d6d6db]">defaultPrivilegeLevel</span>, <span className="font-mono text-[#d6d6db]">allowedPrivilegeLevels</span>. Optional root key: <span className="font-mono text-[#d6d6db]">sandboxPolicyExtensions</span>.</p>
            <p>Valid levels: <span className="font-mono text-[#d6d6db]">{PACKAGE_PRIVILEGE_LEVELS.join(", ")}</span>.</p>
            <p>Sys modes: <span className="font-mono text-[#d6d6db]">{PACKAGE_SANDBOX_SYS_MODES.join(", ")}</span>. Dev modes: <span className="font-mono text-[#d6d6db]">{PACKAGE_SANDBOX_DEV_MODES.join(", ")}</span>. Proc modes: <span className="font-mono text-[#d6d6db]">{PACKAGE_SANDBOX_PROC_MODES.join(", ")}</span>.</p>
            <p>Bind mount modes: <span className="font-mono text-[#d6d6db]">{PACKAGE_SANDBOX_BIND_MOUNT_MODES.join(", ")}</span>. Sandbox extensions apply to <span className="font-mono text-[#d6d6db]">sandbox-ro</span> and <span className="font-mono text-[#d6d6db]">sandbox-rw</span>; <span className="font-mono text-[#d6d6db]">host-privileged</span> still uses systemd-nspawn.</p>
            <p>Current sandbox summary: <span className="text-[#d6d6db]">{formatSandboxPolicySummary(currentPolicyBase.sandboxPolicyExtensions)}</span>.</p>
            {validationErrors.length > 0 ? (
              <div className="space-y-1 rounded-[10px] bg-rose-400/8 px-3 py-2 text-rose-200">
                {validationErrors.map((issue, index) => <p key={`policy-error-${index}`}>{issue.message}</p>)}
              </div>
            ) : null}
            {validationWarnings.length > 0 ? (
              <div className="space-y-1 rounded-[10px] bg-amber-400/8 px-3 py-2 text-amber-100">
                {validationWarnings.map((issue, index) => <p key={`policy-warning-${index}`}>{issue.message}</p>)}
              </div>
            ) : null}
            {validationErrors.length === 0 && validationWarnings.length === 0 ? (
              <p className="text-emerald-200">Policy is valid for the current box and host context.</p>
            ) : null}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!isDirty || isPrivilegeSaving}
              onClick={resetDraft}
              className="rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#a0a0a8] transition hover:border-white/[0.14] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset
            </button>
            <button
              type="button"
              disabled={!isDirty || isPrivilegeSaving || validationErrors.length > 0 || !validation.parsedPolicy}
              onClick={() => { void saveDraft(); }}
              className="rounded-[10px] bg-emerald-400/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-emerald-100 transition hover:bg-emerald-400/22 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PackageBoxModalPresets() {
  const packageBoxes = useInterfaceStore((state) => state.packageBoxes);
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);
  const supportedPackages = useInterfaceStore((state) => state.supportedPackages);
  const packageActionKind = useInterfaceStore((state) => state.packageActionKind);
  const packageActionTarget = useInterfaceStore((state) => state.packageActionTarget);
  const installPackageSet = useInterfaceStore((state) => state.installPackageSet);

  const box = useMemo(
    () => packageBoxes.find((entry) => entry.id === activePackageBoxId) ?? null,
    [activePackageBoxId, packageBoxes],
  );
  const installedPackageIds = useMemo(() => new Set(box?.packages ?? []), [box?.packages]);
  const presets = useMemo(() => {
    return [...createPresetDefinitions(supportedPackages)].sort((left, right) => {
      const leftInstalled = left.packageIds.filter((packageId) => installedPackageIds.has(packageId)).length;
      const rightInstalled = right.packageIds.filter((packageId) => installedPackageIds.has(packageId)).length;
      const byInstalledCount = compareInstalledCounts(leftInstalled, rightInstalled);
      if (byInstalledCount !== 0) {
        return byInstalledCount;
      }

      return left.title.localeCompare(right.title);
    });
  }, [installedPackageIds, supportedPackages]);

  if (!box) {
    return null;
  }

  return (
    <CompactTable
      columns={[
        { key: "preset", label: "Preset", className: "w-[18%]" },
        { key: "packages", label: "Packages", className: "w-[26%]" },
        { key: "description", label: "Description", className: "w-[42%]" },
        { key: "action", label: "Action", className: "w-[14%] text-right" },
      ]}
    >
      {presets.map((preset, index) => {
        const installedCount = preset.packageIds.filter((packageId) => box.packages.includes(packageId)).length;
        const isInstalled = installedCount === preset.packageIds.length;
        const isInstalling = packageActionKind === "install" && packageActionTarget === box.id;

        return (
          <tr key={preset.id} className={`align-top text-[11px] ${tableRowClassName(index)}`}>
            <td className="px-2.5 py-2.5 text-white">{preset.title}</td>
            <td className="px-2.5 py-2.5">{renderPackageList(preset.packageIds, installedPackageIds)}</td>
            <td className="px-2.5 py-2.5 text-[#8b8b95]">{preset.description}</td>
            <td className="px-2.5 py-2.5">
              <div className="flex justify-end">
                <ActionIconButton
                  ariaLabel={isInstalled ? "Preset already installed" : `Install ${preset.title}`}
                  active={isInstalled}
                  disabled={isInstalled || isInstalling}
                  onClick={() => { void installPackageSet(preset.packageIds, box.id); }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M12 3v12" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M5 19h14" />
                  </svg>
                </ActionIconButton>
              </div>
            </td>
          </tr>
        );
      })}
    </CompactTable>
  );
}

function PackageBoxModalPackages() {
  const packageBoxes = useInterfaceStore((state) => state.packageBoxes);
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);
  const supportedPackages = useInterfaceStore((state) => state.supportedPackages);

  const box = useMemo(
    () => packageBoxes.find((entry) => entry.id === activePackageBoxId) ?? null,
    [activePackageBoxId, packageBoxes],
  );
  const boxPackageIds = box?.packages ?? EMPTY_PACKAGE_IDS;
  const installedPackageIds = useMemo(() => new Set(boxPackageIds), [boxPackageIds]);
  const sortedPackages = useMemo(() => {
    return [...supportedPackages].sort((left, right) => {
      const leftInstalled = installedPackageIds.has(left.id) ? 1 : 0;
      const rightInstalled = installedPackageIds.has(right.id) ? 1 : 0;
      const byInstalled = compareInstalledCounts(leftInstalled, rightInstalled);
      if (byInstalled !== 0) {
        return byInstalled;
      }

      return left.id.localeCompare(right.id);
    });
  }, [installedPackageIds, supportedPackages]);

  if (!box) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[10px] bg-white/[0.03] p-3">
        <p className="text-[10px] uppercase tracking-[0.16em] text-[#68686e]">Packages</p>
        <div className="mt-2">
          <CompactTable
            columns={[
              { key: "package", label: "Package", className: "w-[18%]" },
              { key: "bindings", label: "Bindings", className: "w-[24%]" },
              { key: "dependencies", label: "Dependencies", className: "w-[28%]" },
              { key: "description", label: "Description", className: "w-[30%]" },
            ]}
          >
            {sortedPackages.length === 0 ? <CompactTableEmptyRow colSpan={4} label="No package metadata is available yet for this box." /> : null}
            {sortedPackages.map((packageEntry, index) => {
              const isInstalled = installedPackageIds.has(packageEntry.id);
              return (
              <tr key={packageEntry.id} className={`align-top text-[11px] ${tableRowClassName(index)}`}>
                <td className={`px-2.5 py-2.5 ${isInstalled ? "font-semibold text-white" : "font-normal text-[#8b8b95]"}`}>{packageEntry.id}</td>
                <td className="px-2.5 py-2.5 text-[#72727c]">{packageEntry.bindings.map((binding) => binding.id).join(", ")}</td>
                <td className="px-2.5 py-2.5 text-[#8b8b95]">{packageDependencySummary(packageEntry)}</td>
                <td className="px-2.5 py-2.5 text-[#8b8b95]">{packageEntry.description}</td>
              </tr>
            );})}
          </CompactTable>
        </div>
      </div>

   
    </div>
  );
}

function PackageBoxModalTerminal() {
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);

  return <PackageBoxTerminal boxId={activePackageBoxId} />;
}

export default function PackageBoxModalContent() {
  const packageBoxes = useInterfaceStore((state) => state.packageBoxes);
  const activePackageBoxId = useInterfaceStore((state) => state.activePackageBoxId);
  const activePackageBoxTab = useInterfaceStore((state) => state.activePackageBoxTab);
  const setPackageBoxModalTab = useInterfaceStore((state) => state.setPackageBoxModalTab);

  const box = useMemo(
    () => packageBoxes.find((entry) => entry.id === activePackageBoxId) ?? null,
    [activePackageBoxId, packageBoxes],
  );

  const tabs: { id: PackageBoxModalTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "presets", label: "Presets" },
    { id: "packages", label: "Packages" },
    { id: "terminal", label: "Terminal" },
    { id: "policy", label: "Policy" },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-[10px] bg-white/[0.02] px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] text-white">{box?.name ?? activePackageBoxId ?? "Unknown box"}</p>
              {box ? <span className="text-[10px] uppercase tracking-[0.14em] text-[#68686e]">{box.id}</span> : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {tabs.map((tab) => (
              <TabButton
                key={tab.id}
                active={tab.id === activePackageBoxTab}
                label={tab.label}
                onClick={() => setPackageBoxModalTab(tab.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {activePackageBoxTab === "overview" ? <PackageBoxModalOverview /> : null}
      {activePackageBoxTab === "presets" ? <PackageBoxModalPresets /> : null}
      {activePackageBoxTab === "packages" ? <PackageBoxModalPackages /> : null}
      {activePackageBoxTab === "terminal" ? <PackageBoxModalTerminal /> : null}
      {activePackageBoxTab === "policy" ? <PackageBoxModalPolicy /> : null}
    </div>
  );
}