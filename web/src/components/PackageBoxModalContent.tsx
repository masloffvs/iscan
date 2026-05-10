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
  RemotePackageBoxPolicy,
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
const PACKAGE_POLICY_BOOLEAN_KEYS = [
  "allowHostPrivileged",
  "allowSandboxRw",
  "defaultSandboxRw",
  "hostDev",
  "hostProc",
  "hostSys",
  "shareNetwork",
  "unshareUser",
  "unshareIpc",
  "unsharePid",
  "unshareUts",
  "unshareCgroup",
] as const satisfies readonly (keyof RemotePackageBoxPolicy)[];
const DEFAULT_BOX_POLICY: Readonly<RemotePackageBoxPolicy> = {
  allowHostPrivileged: false,
  allowSandboxRw: true,
  defaultSandboxRw: false,
  hostDev: false,
  hostProc: false,
  hostSys: false,
  shareNetwork: true,
  unshareUser: true,
  unshareIpc: true,
  unsharePid: true,
  unshareUts: true,
  unshareCgroup: true,
};
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

type PackageBoxPolicyDraft = RemotePackageBoxPolicy;

type PolicyValidationResult = {
  issues: PolicyValidationIssue[];
  parsedPolicy: PackageBoxPolicyDraft | null;
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

function createDefaultBoxPolicy(): RemotePackageBoxPolicy {
  return {
    allowHostPrivileged: DEFAULT_BOX_POLICY.allowHostPrivileged,
    allowSandboxRw: DEFAULT_BOX_POLICY.allowSandboxRw,
    defaultSandboxRw: DEFAULT_BOX_POLICY.defaultSandboxRw,
    hostDev: DEFAULT_BOX_POLICY.hostDev,
    hostProc: DEFAULT_BOX_POLICY.hostProc,
    hostSys: DEFAULT_BOX_POLICY.hostSys,
    shareNetwork: DEFAULT_BOX_POLICY.shareNetwork,
    unshareUser: DEFAULT_BOX_POLICY.unshareUser,
    unshareIpc: DEFAULT_BOX_POLICY.unshareIpc,
    unsharePid: DEFAULT_BOX_POLICY.unsharePid,
    unshareUts: DEFAULT_BOX_POLICY.unshareUts,
    unshareCgroup: DEFAULT_BOX_POLICY.unshareCgroup,
  };
}

function extractBoxPolicy(value: RemotePackageBoxPolicy): RemotePackageBoxPolicy {
  return {
    allowHostPrivileged: value.allowHostPrivileged,
    allowSandboxRw: value.allowSandboxRw,
    defaultSandboxRw: value.defaultSandboxRw,
    hostDev: value.hostDev,
    hostProc: value.hostProc,
    hostSys: value.hostSys,
    shareNetwork: value.shareNetwork,
    unshareUser: value.unshareUser,
    unshareIpc: value.unshareIpc,
    unsharePid: value.unsharePid,
    unshareUts: value.unshareUts,
    unshareCgroup: value.unshareCgroup,
  };
}

function deriveDefaultPrivilegeLevel(value: RemotePackageBoxPolicy): RemotePackagePrivilegeLevel {
  return value.defaultSandboxRw ? "sandbox-rw" : "sandbox-ro";
}

function deriveAllowedPrivilegeLevels(value: RemotePackageBoxPolicy): RemotePackagePrivilegeLevel[] {
  return orderPrivilegeLevels([
    "sandbox-ro",
    ...(value.allowSandboxRw ? ["sandbox-rw" as const] : []),
    ...(value.allowHostPrivileged ? ["host-privileged" as const] : []),
  ]);
}

function formatPolicyBooleanSummary(value: RemotePackageBoxPolicy): string {
  return PACKAGE_POLICY_BOOLEAN_KEYS
    .map((key) => `${key}=${value[key] ? "true" : "false"}`)
    .join(" · ");
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

function formatSandboxPolicySummary(value: RemotePackageBoxPolicy): string {
  const parts = [
    `sys: ${value.hostSys ? "host-ro" : "off"}`,
    `dev: ${value.hostDev ? "host" : "sandbox"}`,
    `proc: ${value.hostProc ? "host-ro" : "sandbox"}`,
    value.shareNetwork ? "net: shared" : "net: private",
  ];

  return parts.join(" · ");
}

function formatNamespacePolicySummary(value: RemotePackageBoxPolicy): string {
  return [
    `user: ${value.unshareUser ? "private" : "host"}`,
    `ipc: ${value.unshareIpc ? "private" : "host"}`,
    `pid: ${value.unsharePid ? "private" : "host"}`,
    `uts: ${value.unshareUts ? "private" : "host"}`,
    `cgroup: ${value.unshareCgroup ? "private" : "host"}`,
  ].join(" · ");
}

function formatBwrapFlagSummary(value: RemotePackageBoxPolicy, boxId: string): string {
  const flags: string[] = [];

  if (value.unshareUser) {
    flags.push("--unshare-user", "--uid 0", "--gid 0");
  }

  if (value.unshareIpc) {
    flags.push("--unshare-ipc");
  }

  if (value.unsharePid) {
    flags.push("--unshare-pid");
  }

  if (!value.shareNetwork) {
    flags.push("--unshare-net");
  }

  if (value.unshareUts) {
    flags.push("--unshare-uts", `--hostname ${boxId}-box`);
  }

  if (value.unshareCgroup) {
    flags.push("--unshare-cgroup");
  }

  return flags.length > 0 ? flags.join(" ") : "no namespace flags";
}

function parsePolicyBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
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

function formatPolicyJson(policy: RemotePackageBoxPolicy): string {
  return JSON.stringify({
    allowHostPrivileged: policy.allowHostPrivileged,
    allowSandboxRw: policy.allowSandboxRw,
    defaultSandboxRw: policy.defaultSandboxRw,
    hostDev: policy.hostDev,
    hostProc: policy.hostProc,
    hostSys: policy.hostSys,
    shareNetwork: policy.shareNetwork,
    unshareUser: policy.unshareUser,
    unshareIpc: policy.unshareIpc,
    unsharePid: policy.unsharePid,
    unshareUts: policy.unshareUts,
    unshareCgroup: policy.unshareCgroup,
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

  const candidate = value as Partial<Record<(typeof PACKAGE_POLICY_BOOLEAN_KEYS)[number], unknown>>;

  return {
    allowHostPrivileged: parsePolicyBoolean(candidate.allowHostPrivileged, "allowHostPrivileged"),
    allowSandboxRw: parsePolicyBoolean(candidate.allowSandboxRw, "allowSandboxRw"),
    defaultSandboxRw: parsePolicyBoolean(candidate.defaultSandboxRw, "defaultSandboxRw"),
    hostDev: parsePolicyBoolean(candidate.hostDev, "hostDev"),
    hostProc: parsePolicyBoolean(candidate.hostProc, "hostProc"),
    hostSys: parsePolicyBoolean(candidate.hostSys, "hostSys"),
    shareNetwork: parsePolicyBoolean(candidate.shareNetwork, "shareNetwork"),
    unshareUser: parsePolicyBoolean(candidate.unshareUser, "unshareUser"),
    unshareIpc: parsePolicyBoolean(candidate.unshareIpc, "unshareIpc"),
    unsharePid: parsePolicyBoolean(candidate.unsharePid, "unsharePid"),
    unshareUts: parsePolicyBoolean(candidate.unshareUts, "unshareUts"),
    unshareCgroup: parsePolicyBoolean(candidate.unshareCgroup, "unshareCgroup"),
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
    const unknownKeys = Object.keys(candidate).filter((key) => !PACKAGE_POLICY_BOOLEAN_KEYS.includes(key as (typeof PACKAGE_POLICY_BOOLEAN_KEYS)[number]));
    if (unknownKeys.length > 0) {
      issues.push({
        severity: "warning",
        message: `Unknown key(s) will be ignored by the policy editor: ${unknownKeys.join(", ")}.`,
      });
    }
  }

  let parsedPolicy: PolicyValidationResult["parsedPolicy"] = null;
  try {
    parsedPolicy = parsePolicyJsonValue(parsed);
  } catch (error) {
    issues.push({ severity: "error", message: error instanceof Error ? error.message : String(error) });
    return { issues, parsedPolicy: null };
  }

  if (parsedPolicy.defaultSandboxRw && !parsedPolicy.allowSandboxRw) {
    issues.push({
      severity: "error",
      message: "defaultSandboxRw=true requires allowSandboxRw=true.",
    });
  }

  if (!parsedPolicy.shareNetwork) {
    issues.push({
      severity: "warning",
      message: "shareNetwork=false adds --unshare-net; scanners and package downloads stop seeing the host network unless the box has its own routing.",
    });
  }

  if (parsedPolicy.hostDev) {
    issues.push({
      severity: "warning",
      message: "hostDev=true bind-mounts the host /dev tree into sandbox runs.",
    });
  }

  if (parsedPolicy.hostProc) {
    issues.push({
      severity: "warning",
      message: "hostProc=true bind-mounts the host /proc tree read-only into sandbox runs.",
    });
  }

  if (parsedPolicy.hostSys) {
    issues.push({
      severity: "warning",
      message: "hostSys=true bind-mounts the host /sys tree read-only into sandbox runs.",
    });
  }

  if (!parsedPolicy.unshareUser) {
    issues.push({
      severity: "warning",
      message: "unshareUser=false drops --unshare-user and the fake root uid/gid mapping; the command runs as the host user instead of uid 0 inside bwrap.",
    });
  }

  if (!parsedPolicy.unshareIpc) {
    issues.push({
      severity: "warning",
      message: "unshareIpc=false shares the host IPC namespace with sandbox runs.",
    });
  }

  if (!parsedPolicy.unsharePid) {
    issues.push({
      severity: "warning",
      message: "unsharePid=false shares the host PID namespace with sandbox runs.",
    });
  }

  if (!parsedPolicy.unshareUts) {
    issues.push({
      severity: "warning",
      message: "unshareUts=false skips the sandbox hostname override and keeps the host UTS namespace.",
    });
  }

  if (!parsedPolicy.unshareCgroup) {
    issues.push({
      severity: "warning",
      message: "unshareCgroup=false shares the host cgroup namespace with sandbox runs.",
    });
  }

  if (parsedPolicy.allowHostPrivileged) {
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
  "allowHostPrivileged": false,
  "allowSandboxRw": true,
  "defaultSandboxRw": false,
  "hostDev": false,
  "hostProc": false,
  "hostSys": false,
  "shareNetwork": true,
  "unshareUser": true,
  "unshareIpc": true,
  "unsharePid": true,
  "unshareUts": true,
  "unshareCgroup": true
}`,
  detail: "Insert a flat boolean-only policy object",
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
  return [
    {
      label: "allowHostPrivileged",
      type: "property",
      apply: inStringContext ? "allowHostPrivileged\"" : '"allowHostPrivileged": false',
      detail: "Allow host-privileged overrides through systemd-nspawn",
    },
    {
      label: "allowSandboxRw",
      type: "property",
      apply: inStringContext ? "allowSandboxRw\"" : '"allowSandboxRw": true',
      detail: "Allow sandbox-rw overrides in addition to sandbox-ro",
    },
    {
      label: "defaultSandboxRw",
      type: "property",
      apply: inStringContext ? "defaultSandboxRw\"" : '"defaultSandboxRw": false',
      detail: "Use sandbox-rw as the box default instead of sandbox-ro",
    },
    {
      label: "hostDev",
      type: "property",
      apply: inStringContext ? "hostDev\"" : '"hostDev": false',
      detail: "Bind the host /dev tree into sandbox runs",
    },
    {
      label: "hostProc",
      type: "property",
      apply: inStringContext ? "hostProc\"" : '"hostProc": false',
      detail: "Bind the host /proc tree read-only into sandbox runs",
    },
    {
      label: "hostSys",
      type: "property",
      apply: inStringContext ? "hostSys\"" : '"hostSys": false',
      detail: "Bind the host /sys tree read-only into sandbox runs",
    },
    {
      label: "shareNetwork",
      type: "property",
      apply: inStringContext ? "shareNetwork\"" : '"shareNetwork": true',
      detail: "Share or isolate the host network namespace for sandbox runs",
    },
    {
      label: "unshareUser",
      type: "property",
      apply: inStringContext ? "unshareUser\"" : '"unshareUser": true',
      detail: "Toggle --unshare-user and the uid/gid 0 mapping for bwrap runs",
    },
    {
      label: "unshareIpc",
      type: "property",
      apply: inStringContext ? "unshareIpc\"" : '"unshareIpc": true',
      detail: "Toggle --unshare-ipc for bwrap runs",
    },
    {
      label: "unsharePid",
      type: "property",
      apply: inStringContext ? "unsharePid\"" : '"unsharePid": true',
      detail: "Toggle --unshare-pid for bwrap runs",
    },
    {
      label: "unshareUts",
      type: "property",
      apply: inStringContext ? "unshareUts\"" : '"unshareUts": true',
      detail: "Toggle --unshare-uts and the sandbox hostname override",
    },
    {
      label: "unshareCgroup",
      type: "property",
      apply: inStringContext ? "unshareCgroup\"" : '"unshareCgroup": true',
      detail: "Toggle --unshare-cgroup for bwrap runs",
    },
  ];
}

function createPolicyValueCompletions(
  kind: "privilege" | "sys" | "dev" | "proc" | "bindMode" | "boolean",
  inStringContext: boolean,
): Completion[] {
  return createBooleanValueCompletions();
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
  const isBooleanValueContext = /"(?:allowHostPrivileged|allowSandboxRw|defaultSandboxRw|hostDev|hostProc|hostSys|shareNetwork|unshareUser|unshareIpc|unsharePid|unshareUts|unshareCgroup)"\s*:\s*$/u.test(prefix);

  if (prefix.trim().length === 0) {
    return createPolicyCompletionResult(0, context.pos, [POLICY_TEMPLATE_COMPLETION, ...createPolicyKeyCompletions("root", false)]);
  }

  const openStringMatch = prefix.match(/"[^"\n\r]*$/u);
  if (openStringMatch) {
    const fragment = openStringMatch[0].slice(1);
    const beforeString = prefix.slice(0, prefix.length - openStringMatch[0].length);
    const from = context.pos - fragment.length;

    if (/[{,]\s*$/u.test(beforeString)) {
      return createPolicyCompletionResult(from, context.pos, createPolicyKeyCompletions("root", true));
    }
  }

  if (context.explicit && (/[{,]\s*$/u.test(prefix) || /\{\s*$/u.test(prefix))) {
    return createPolicyCompletionResult(context.pos, context.pos, createPolicyKeyCompletions("root", false));
  }

  if (context.explicit && isBooleanValueContext) {
    return createPolicyCompletionResult(context.pos, context.pos, createPolicyValueCompletions("boolean", false));
  }

  if (isBooleanValueContext) {
    return createPolicyCompletionResult(context.pos, context.pos, createPolicyValueCompletions("boolean", false));
  }

  return null;
}

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
  const boxPolicy = extractBoxPolicy(box);
  const defaultPrivilegeLevel = deriveDefaultPrivilegeLevel(boxPolicy);
  const allowedPrivilegeLevels = deriveAllowedPrivilegeLevels(boxPolicy);
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
            { field: "Privilege default", value: <span className="text-[#d6d6db]">{formatPrivilegeLevel(defaultPrivilegeLevel)}</span> },
            { field: "Allowed privileges", value: <span className="text-[#d6d6db]">{formatAllowedPrivilegeLevels(allowedPrivilegeLevels)}</span> },
            { field: "Policy flags", value: <span className="break-words font-mono text-[10px] text-[#d6d6db]">{formatPolicyBooleanSummary(boxPolicy)}</span> },
            {
              field: "Sandbox mounts",
              value: <p className="text-[#d6d6db]">{formatSandboxPolicySummary(boxPolicy)}</p>,
            },
            {
              field: "Namespaces",
              value: <p className="text-[#d6d6db]">{formatNamespacePolicySummary(boxPolicy)}</p>,
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

    setDraftSource(formatPolicyJson(extractBoxPolicy(box)));
  }, [box]);

  if (!box) {
    return null;
  }

  const isPrivilegeSaving = packageActionKind === "privilege" && packageActionTarget === box.id;
  const canonicalSource = formatPolicyJson(extractBoxPolicy(box));
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

  const currentPolicyBase: PackageBoxPolicyDraft = validation.parsedPolicy ?? extractBoxPolicy(box);
  const derivedAllowedPrivileges = deriveAllowedPrivilegeLevels(currentPolicyBase);
  const derivedDefaultPrivilege = deriveDefaultPrivilegeLevel(currentPolicyBase);

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
            <p className="mt-1 text-[11px] text-[#8b8b95]">Edit the flat box policy JSON. Every root key is boolean-only and maps directly to runtime bwrap behavior.</p>
          </div>

          {isPrivilegeSaving ? <StatusPill tone="default" value="saving" /> : null}
        </div>

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
            <p>Keys: <span className="font-mono text-[#d6d6db]">{PACKAGE_POLICY_BOOLEAN_KEYS.join(", ")}</span>.</p>
            <p>Privilege: default <span className="font-mono text-[#d6d6db]">{derivedDefaultPrivilege}</span> · allowed <span className="font-mono text-[#d6d6db]">{derivedAllowedPrivileges.join(", ")}</span>.</p>
            <p>Mounts: <span className="text-[#d6d6db]">{formatSandboxPolicySummary(currentPolicyBase)}</span>.</p>
            <p>Namespaces: <span className="text-[#d6d6db]">{formatNamespacePolicySummary(currentPolicyBase)}</span>.</p>
            <p>Bwrap flags: <span className="break-all font-mono text-[#d6d6db]">{formatBwrapFlagSummary(currentPolicyBase, box.id)}</span>.</p>
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