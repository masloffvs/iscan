import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  $manifest,
  type ManifestDependencyStatus,
  type ResolvedQemuManifestConfig,
} from "../manifest";

import { Kit, type KitInfo, type KitLifecycleContext } from "./kit";

export const QEMU_KIT_ID = "qemu";
export const QEMU_DISK_INTERFACES = ["virtio", "ide", "scsi"] as const;
const ROUTER_DEFAULT_DOMAIN = "localdomain";
const ROUTER_DEFAULT_LAN_ADDRESS = "192.168.1.1";
const ROUTER_DEFAULT_LAN_PREFIX = 24;
const ROUTER_DEFAULT_DHCP_START = "192.168.1.100";
const ROUTER_DEFAULT_DHCP_END = "192.168.1.199";
const ROUTER_DEFAULT_WAN_INTERFACE = "em0";
const ROUTER_DEFAULT_LAN_INTERFACE = "em1";
const ROUTER_DEFAULT_HOST_WEB_HOST = "127.0.0.1";
const ROUTER_DEFAULT_HOST_HTTP_PORT = 8080;
const ROUTER_DEFAULT_HOST_HTTPS_PORT = 8443;
const ROUTER_DEFAULT_HOST_SSH_PORT = 22022;
const ROUTER_MANAGED_WAN_NETDEV = `user,id=wan,hostfwd=tcp:${ROUTER_DEFAULT_HOST_WEB_HOST}:${ROUTER_DEFAULT_HOST_HTTPS_PORT}-:443,hostfwd=tcp:${ROUTER_DEFAULT_HOST_WEB_HOST}:${ROUTER_DEFAULT_HOST_HTTP_PORT}-:80,hostfwd=tcp:${ROUTER_DEFAULT_HOST_WEB_HOST}:${ROUTER_DEFAULT_HOST_SSH_PORT}-:22`;
const ROUTER_MANAGED_WAN_DEVICE = "e1000,netdev=wan,mac=52:54:00:12:34:56";
const ROUTER_MANAGED_LAN_NETDEV = "tap,id=lan,ifname=tap0,script=no,downscript=no";
const ROUTER_MANAGED_LAN_DEVICE = "e1000,netdev=lan,mac=52:54:00:12:34:57";
const ROUTER_IMPORT_DIRECTORY = "qemu-router-import";
const ROUTER_PREPARED_INSTALLER_ISO_NAME = "installer-prepared.iso";
const ROUTER_INSTALLER_EMBEDDED_CONFIG_PATH = "/conf/config.xml";
const ROUTER_BOOTSTRAP_USERNAME = "root";
const ROUTER_BOOTSTRAP_PASSWORD = "opnsense";
const ROUTER_BOOTSTRAP_TIMEOUT_MS = 120_000;
const ROUTER_BOOTSTRAP_POLL_INTERVAL_MS = 2_000;
const ROUTER_BOOTSTRAP_FACTORY_LAN_NETWORK = "192.168.1.0/24";
const MANAGED_TAP_BRIDGE_NAME = "br0";
const MANAGED_TAP_STATE_DIRECTORY = path.join(
  os.tmpdir(),
  "iscan-qemu-network",
);

const QEMU_KIT_INFO: KitInfo = {
  id: QEMU_KIT_ID,
  name: "QemuKit",
  category: "virtualization",
  description: "Reusable QEMU wrapper with manifest-aware dependency checks.",
  tags: ["qemu", "vm", "virtual-machine", "proxychains"],
};

export type QemuKitOptions = Partial<ResolvedQemuManifestConfig>;
export type QemuDiskInterface = (typeof QEMU_DISK_INTERFACES)[number];
export type QemuVmRole = "router";
export type QemuRouterNetworkConfig = {
  hostname?: string;
  domain?: string;
  wanInterface?: string;
  lanInterface?: string;
  lanAddress?: string;
  lanPrefix?: number;
  dhcpStart?: string;
  dhcpEnd?: string;
  importDirectory?: string;
};

export type QemuLaunchSpec = {
  diskImage?: string;
  diskFormat?: string;
  diskInterface?: QemuDiskInterface;
  cdrom?: string;
  kernel?: string;
  initrd?: string;
  append?: string;
  memoryMb?: number;
  machine?: string;
  accelerator?: string;
  cpu?: string;
  smp?: number;
  useProxy?: boolean;
  headless?: boolean;
  snapshot?: boolean;
  daemonize?: boolean;
  enableKvm?: boolean;
  routerNetwork?: QemuRouterNetworkConfig;
  args?: readonly string[];
};

export type QemuVmPreset = QemuLaunchSpec & {
  id: string;
  name: string;
  role?: QemuVmRole;
};

export type QemuDiskImageSpec = {
  path: string;
  size: string;
  format?: string;
  overwrite?: boolean;
  cwd?: string;
  env?: Record<string, string>;
};

export type QemuDiskCopySpec = {
  sourcePath: string;
  path: string;
  overwrite?: boolean;
};

export type QemuCommandPreview = {
  command: readonly string[];
  usesProxy: boolean;
};

export type QemuCommandResult = {
  command: readonly string[];
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type QemuSpawnOptions = {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: "inherit" | "ignore" | "pipe";
};

export type QemuKitEnvironmentReport = {
  config: ResolvedQemuManifestConfig;
  system: ManifestDependencyStatus;
  imageTool: ManifestDependencyStatus;
  proxy: ManifestDependencyStatus;
  runningProcessCount: number;
};

export type QemuRouterBootstrapStatus =
  | "bootstrapped"
  | "needs-bootstrap"
  | "uninstalled"
  | "in-use"
  | "unknown";

export type QemuRouterBootstrapState = {
  status: QemuRouterBootstrapStatus;
  reason: string;
};

export type QemuRouterBootstrapProgress = {
  stage:
    | "inspect"
    | "detach-installer"
    | "start-helper"
    | "wait-ui"
    | "login"
    | "restore-config"
    | "wait-reboot"
    | "complete"
    | "skip";
  message: string;
  createdAt: number;
};

export type QemuRouterBootstrapResult = {
  presetId: string;
  presetName: string;
  initialState: QemuRouterBootstrapState;
  finalState: QemuRouterBootstrapState;
  detachedInstallerMedia: boolean;
  rebootRequested: boolean;
  skipped: boolean;
  steps: readonly QemuRouterBootstrapProgress[];
};

export type QemuRouterBootstrapOptions = {
  onProgress?: (progress: QemuRouterBootstrapProgress) => void;
  throwOnUnknown?: boolean;
  username?: string;
  password?: string;
  rebootAfterRestore?: boolean;
};

export type QemuPrepareInstallerIsoOptions = {
  sourceIsoPath?: string;
  outputIsoPath?: string;
  overwrite?: boolean;
};

export type QemuPrepareInstallerIsoResult = {
  presetId: string;
  presetName: string;
  sourceIsoPath: string;
  outputIsoPath: string;
  configPath: string;
  embeddedConfigPath: string;
  overwritten: boolean;
};

type QemuRouterBootstrapHelper = {
  baseUrl: string;
  pidFilePath: string;
  tempDirectory: string;
};

type SimpleHttpsResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

type QemuManagedTapNetwork = {
  bridgeName: string;
  tapNames: string[];
  createdTapNames: string[];
  bridgeMarkerPath: string;
};

type QemuTrackedProcessMetadata = {
  tempDirectory?: string;
  pidFilePath?: string;
  managedTapNetwork?: QemuManagedTapNetwork;
};

type QemuDaemonLaunchTracking = {
  tempDirectory: string;
  pidFilePath: string;
};

type QemuTerminationSignal = "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGQUIT";

const QEMU_TERMINATION_SIGNALS: readonly QemuTerminationSignal[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
  "SIGQUIT",
];
const QEMU_TERMINATION_EXIT_CODES: Record<QemuTerminationSignal, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
  SIGQUIT: 131,
};
const QEMU_DAEMON_PIDFILE_TIMEOUT_MS = 5_000;
const QEMU_DAEMON_PIDFILE_POLL_MS = 50;
const QEMU_TRACKED_PROCESS_POLL_MS = 1_000;

function isManagedTapNetdevArgument(value: string): boolean {
  return (
    value.startsWith("tap,") &&
    /(?:^|,)ifname=[^,]+(?:,|$)/u.test(value) &&
    /(?:^|,)script=no(?:,|$)/u.test(value)
  );
}

function extractManagedTapInterfaceNames(command: readonly string[]): string[] {
  const tapNames = new Set<string>();

  for (const value of command) {
    if (!isManagedTapNetdevArgument(value)) {
      continue;
    }

    const match = /(?:^|,)ifname=([^,]+)(?:,|$)/u.exec(value);
    const tapName = match?.[1]?.trim();
    if (tapName) {
      tapNames.add(tapName);
    }
  }

  return [...tapNames];
}

function getManagedTapBridgeMarkerPath(bridgeName: string): string {
  return path.join(MANAGED_TAP_STATE_DIRECTORY, `${bridgeName}.managed`);
}

function getBridgeMembersPath(bridgeName: string): string {
  return path.join("/sys/class/net", bridgeName, "brif");
}

function networkInterfaceExists(interfaceName: string): boolean {
  return existsSync(path.join("/sys/class/net", interfaceName));
}

function readBridgeMembersSync(bridgeName: string): string[] {
  const membersPath = getBridgeMembersPath(bridgeName);
  if (!existsSync(membersPath)) {
    return [];
  }

  try {
    return readdirSync(membersPath).filter(Boolean);
  } catch {
    return [];
  }
}

function buildSyncCommandErrorMessage(
  result: ReturnType<typeof Bun.spawnSync>,
  fallbackMessage: string,
): string {
  const stdout = Buffer.from(result.stdout ?? []).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr ?? []).toString("utf8").trim();
  const details = [stderr, stdout].filter(Boolean).join("\n");
  return details ? `${fallbackMessage}\n${details}` : fallbackMessage;
}

function runManagedNetworkCommandSync(
  command: readonly string[],
  failureMessage: string,
  options: { interactive?: boolean } = {},
): void {
  const interactive = options.interactive ?? false;
  const result = Bun.spawnSync({
    cmd: [...command],
    cwd: process.cwd(),
    env: buildEnvironment(),
    stdin: interactive ? "inherit" : "ignore",
    stdout: interactive ? "inherit" : "pipe",
    stderr: interactive ? "inherit" : "pipe",
  });

  if (result.exitCode === 0) {
    return;
  }

  throw new Error(
    interactive
      ? failureMessage
      : buildSyncCommandErrorMessage(result, failureMessage),
  );
}

function tryRunManagedNetworkCommandSync(
  command: readonly string[],
  options: { interactive?: boolean } = {},
): boolean {
  try {
    const interactive = options.interactive ?? false;
    const result = Bun.spawnSync({
      cmd: [...command],
      cwd: process.cwd(),
      env: buildEnvironment(),
      stdin: interactive ? "inherit" : "ignore",
      stdout: interactive ? "inherit" : "ignore",
      stderr: interactive ? "inherit" : "ignore",
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function removeManagedTapBridgeMarkerSync(bridgeMarkerPath: string): void {
  try {
    rmSync(bridgeMarkerPath, { force: true });
  } catch {
    // Ignore best-effort cleanup failures.
  }
}

function getManagedTapOwnerName(): string | null {
  const environmentUser =
    process.env.SUDO_USER?.trim() || process.env.USER?.trim() || "";
  if (environmentUser && environmentUser !== "root") {
    return environmentUser;
  }

  try {
    const username = os.userInfo().username.trim();
    return username && username !== "root" ? username : null;
  } catch {
    return null;
  }
}

function cleanupManagedTapNetworkingSync(
  managedTapNetwork: QemuManagedTapNetwork | undefined,
  options: { interactive?: boolean } = {},
): void {
  if (!managedTapNetwork) {
    return;
  }

  const interactive = options.interactive ?? false;
  const sudoPrefix = interactive ? ["sudo"] : ["sudo", "-n"];
  const uniqueCreatedTapNames = [...new Set(managedTapNetwork.createdTapNames)].reverse();

  for (const tapName of uniqueCreatedTapNames) {
    if (!networkInterfaceExists(tapName)) {
      continue;
    }

    tryRunManagedNetworkCommandSync(
      [...sudoPrefix, "ip", "link", "delete", "dev", tapName],
      { interactive },
    );
  }

  if (!existsSync(managedTapNetwork.bridgeMarkerPath)) {
    return;
  }

  if (!networkInterfaceExists(managedTapNetwork.bridgeName)) {
    removeManagedTapBridgeMarkerSync(managedTapNetwork.bridgeMarkerPath);
    return;
  }

  if (readBridgeMembersSync(managedTapNetwork.bridgeName).length > 0) {
    return;
  }

  const removedBridge = tryRunManagedNetworkCommandSync(
    [...sudoPrefix, "ip", "link", "delete", "dev", managedTapNetwork.bridgeName],
    { interactive },
  );

  if (removedBridge || !networkInterfaceExists(managedTapNetwork.bridgeName)) {
    removeManagedTapBridgeMarkerSync(managedTapNetwork.bridgeMarkerPath);
  }
}

function ensureManagedTapNetworkingSync(
  command: readonly string[],
): QemuManagedTapNetwork | null {
  const tapNames = extractManagedTapInterfaceNames(command);
  if (tapNames.length === 0) {
    return null;
  }

  const managedTapNetwork: QemuManagedTapNetwork = {
    bridgeName: MANAGED_TAP_BRIDGE_NAME,
    tapNames,
    createdTapNames: [],
    bridgeMarkerPath: getManagedTapBridgeMarkerPath(MANAGED_TAP_BRIDGE_NAME),
  };
  const tapOwnerName = getManagedTapOwnerName();

  try {
    if (!networkInterfaceExists(managedTapNetwork.bridgeName)) {
      try {
        runManagedNetworkCommandSync(
          ["sudo", "ip", "link", "add", managedTapNetwork.bridgeName, "type", "bridge"],
          `Failed to create bridge '${managedTapNetwork.bridgeName}'.`,
          { interactive: true },
        );
        mkdirSync(MANAGED_TAP_STATE_DIRECTORY, { recursive: true });
        writeFileSync(managedTapNetwork.bridgeMarkerPath, `${managedTapNetwork.bridgeName}\n`);
      } catch (error) {
        if (!networkInterfaceExists(managedTapNetwork.bridgeName)) {
          throw error;
        }
      }
    }

    runManagedNetworkCommandSync(
      ["sudo", "ip", "link", "set", managedTapNetwork.bridgeName, "up"],
      `Failed to bring bridge '${managedTapNetwork.bridgeName}' up.`,
      { interactive: true },
    );

    for (const tapName of managedTapNetwork.tapNames) {
      if (!networkInterfaceExists(tapName)) {
        const createTapCommand = [
          "sudo",
          "ip",
          "tuntap",
          "add",
          "dev",
          tapName,
          "mode",
          "tap",
        ];
        if (tapOwnerName) {
          createTapCommand.push("user", tapOwnerName);
        }

        try {
          runManagedNetworkCommandSync(
            createTapCommand,
            `Failed to create tap interface '${tapName}'.`,
            { interactive: true },
          );
          managedTapNetwork.createdTapNames.push(tapName);
        } catch (error) {
          if (!networkInterfaceExists(tapName)) {
            throw error;
          }
        }
      }

      runManagedNetworkCommandSync(
        ["sudo", "ip", "link", "set", tapName, "up"],
        `Failed to bring tap interface '${tapName}' up.`,
        { interactive: true },
      );
      runManagedNetworkCommandSync(
        ["sudo", "ip", "link", "set", tapName, "master", managedTapNetwork.bridgeName],
        `Failed to attach tap interface '${tapName}' to bridge '${managedTapNetwork.bridgeName}'.`,
        { interactive: true },
      );
    }

    return managedTapNetwork;
  } catch (error) {
    cleanupManagedTapNetworkingSync(managedTapNetwork);
    throw error;
  }
}

function createDaemonLaunchTracking(): QemuDaemonLaunchTracking {
  const tempDirectory = mkdtempSync(
    path.join(os.tmpdir(), "iscan-qemu-launch-"),
  );
  return {
    tempDirectory,
    pidFilePath: path.join(tempDirectory, "qemu.pid"),
  };
}

function removeTrackingArtifactsSync(
  metadata: QemuTrackedProcessMetadata | undefined,
): void {
  cleanupManagedTapNetworkingSync(metadata?.managedTapNetwork);

  if (!metadata?.tempDirectory) {
    return;
  }

  try {
    rmSync(metadata.tempDirectory, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures during shutdown.
  }
}

async function removeTrackingArtifacts(
  metadata: QemuTrackedProcessMetadata | undefined,
): Promise<void> {
  cleanupManagedTapNetworkingSync(metadata?.managedTapNetwork);

  if (!metadata?.tempDirectory) {
    return;
  }

  await fs.rm(metadata.tempDirectory, { recursive: true, force: true });
}

async function waitForPidFile(
  pidFilePath: string,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const pidText = await fs.readFile(pidFilePath, "utf8");
      const pid = Number(pidText.trim());
      if (Number.isInteger(pid) && pid > 1) {
        return pid;
      }
    } catch {
      // Ignore pidfile races while the daemon starts.
    }

    await delay(QEMU_DAEMON_PIDFILE_POLL_MS);
  }

  throw new Error(`Timed out waiting for QEMU pidfile: ${pidFilePath}`);
}

async function waitForProcessExit(pid: number): Promise<void> {
  while (true) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }

    await delay(QEMU_TRACKED_PROCESS_POLL_MS);
  }
}

function withDefinedOverrides<T extends object>(
  base: T,
  overrides: Partial<T>,
): T {
  const entries = Object.entries(overrides).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) {
    return { ...base };
  }

  return {
    ...base,
    ...(Object.fromEntries(entries) as Partial<T>),
  };
}

function normalizePositiveInteger(
  value: number | undefined,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function normalizeDiskInterface(
  value: QemuDiskInterface | string | undefined,
  label: string,
): QemuDiskInterface | undefined {
  const normalized = normalizeOptionalString(
    typeof value === "string" ? value : value,
  );
  if (!normalized) {
    return undefined;
  }

  if (QEMU_DISK_INTERFACES.includes(normalized as QemuDiskInterface)) {
    return normalized as QemuDiskInterface;
  }

  throw new Error(
    `${label} must be one of: ${QEMU_DISK_INTERFACES.join(", ")}.`,
  );
}

function normalizeVmRole(
  value: QemuVmRole | string | undefined,
  label: string,
): QemuVmRole | undefined {
  const normalized = normalizeOptionalString(
    typeof value === "string" ? value : value,
  );
  if (!normalized) {
    return undefined;
  }

  if (normalized === "router") {
    return "router";
  }

  throw new Error(`${label} must be: router.`);
}

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function slugifyRouterName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createDefaultRouterHostname(name: string): string {
  return slugifyRouterName(name) || "opnsense";
}

function buildRouterImportDirectory(name: string): string {
  return path.join(
    process.cwd(),
    ".iscan",
    ROUTER_IMPORT_DIRECTORY,
    createDefaultRouterHostname(name),
  );
}

function buildPreparedRouterInstallerIsoPath(name: string): string {
  return path.join(
    buildRouterImportDirectory(name),
    ROUTER_PREPARED_INSTALLER_ISO_NAME,
  );
}

function createDefaultRouterNetworkConfig(
  name: string,
): Required<QemuRouterNetworkConfig> {
  return {
    hostname: createDefaultRouterHostname(name),
    domain: ROUTER_DEFAULT_DOMAIN,
    wanInterface: ROUTER_DEFAULT_WAN_INTERFACE,
    lanInterface: ROUTER_DEFAULT_LAN_INTERFACE,
    lanAddress: ROUTER_DEFAULT_LAN_ADDRESS,
    lanPrefix: ROUTER_DEFAULT_LAN_PREFIX,
    dhcpStart: ROUTER_DEFAULT_DHCP_START,
    dhcpEnd: ROUTER_DEFAULT_DHCP_END,
    importDirectory: buildRouterImportDirectory(name),
  };
}

function normalizeRouterNetworkConfig(
  value: QemuRouterNetworkConfig | undefined,
  label: string,
  presetName?: string,
): QemuRouterNetworkConfig | undefined {
  if (!value && !presetName) {
    return undefined;
  }

  const defaults = presetName
    ? createDefaultRouterNetworkConfig(presetName)
    : undefined;

  return {
    hostname: normalizeOptionalString(value?.hostname) ?? defaults?.hostname,
    domain: normalizeOptionalString(value?.domain) ?? defaults?.domain,
    wanInterface:
      normalizeOptionalString(value?.wanInterface) ?? defaults?.wanInterface,
    lanInterface:
      normalizeOptionalString(value?.lanInterface) ?? defaults?.lanInterface,
    lanAddress:
      normalizeOptionalString(value?.lanAddress) ?? defaults?.lanAddress,
    lanPrefix:
      normalizePositiveInteger(value?.lanPrefix, `${label} lanPrefix`) ??
      defaults?.lanPrefix,
    dhcpStart: normalizeOptionalString(value?.dhcpStart) ?? defaults?.dhcpStart,
    dhcpEnd: normalizeOptionalString(value?.dhcpEnd) ?? defaults?.dhcpEnd,
    importDirectory:
      normalizeOptionalString(value?.importDirectory) ??
      defaults?.importDirectory,
  };
}

function migrateLegacyRouterNetworkConfig(
  routerNetwork: QemuRouterNetworkConfig | undefined,
): QemuRouterNetworkConfig | undefined {
  if (!routerNetwork) {
    return undefined;
  }

  if (
    routerNetwork.wanInterface === "em1" &&
    routerNetwork.lanInterface === "em0"
  ) {
    return {
      ...routerNetwork,
      wanInterface: ROUTER_DEFAULT_WAN_INTERFACE,
      lanInterface: ROUTER_DEFAULT_LAN_INTERFACE,
    };
  }

  return routerNetwork;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildRouterConfigXml(
  routerNetwork: Required<QemuRouterNetworkConfig>,
): string {
  const revisionTime = Math.floor(Date.now() / 1000);

  return [
    '<?xml version="1.0"?>',
    "<opnsense>",
    "  <system>",
    `    <hostname>${escapeXml(routerNetwork.hostname)}</hostname>`,
    `    <domain>${escapeXml(routerNetwork.domain)}</domain>`,
    "    <timezone>Etc/UTC</timezone>",
    "    <webgui>",
    "      <protocol>http</protocol>",
    "      <port>80</port>",
    "      <authmode>Local Database</authmode>",
    "    </webgui>",
    "  </system>",
    "  <interfaces>",
    "    <wan>",
    `      <if>${routerNetwork.wanInterface}</if>`,
    "      <enable>1</enable>",
    "      <ipaddr>dhcp</ipaddr>",
    "      <ipaddrv6>dhcp6</ipaddrv6>",
    "      <blockpriv>0</blockpriv>",
    "      <blockbogons>1</blockbogons>",
    "    </wan>",
    "    <lan>",
    `      <if>${routerNetwork.lanInterface}</if>`,
    "      <enable>1</enable>",
    `      <ipaddr>${routerNetwork.lanAddress}</ipaddr>`,
    `      <subnet>${routerNetwork.lanPrefix}</subnet>`,
    "      <blockpriv>0</blockpriv>",
    "      <blockbogons>0</blockbogons>",
    "    </lan>",
    "  </interfaces>",
    "  <dnsmasq>",
    "    <enable>1</enable>",
    "    <port>53</port>",
    "  </dnsmasq>",
    "  <dhcpd>",
    "    <lan>",
    "      <enable/>",
    "      <range>",
    `        <from>${routerNetwork.dhcpStart}</from>`,
    `        <to>${routerNetwork.dhcpEnd}</to>`,
    "      </range>",
    "    </lan>",
    "  </dhcpd>",
    "  <filter>",
    "    <rule>",
    "      <type>pass</type>",
    "      <interface>wan</interface>",
    "      <ipprotocol>inet</ipprotocol>",
    "      <protocol>tcp</protocol>",
    "      <source>",
    "        <any/>",
    "      </source>",
    "      <destination>",
    "        <network>wanip</network>",
    "        <port>80</port>",
    "      </destination>",
    "      <descr>Allow host-forwarded web UI access on WAN</descr>",
    "    </rule>",
    "  </filter>",
    "  <nat>",
    "    <outbound>",
    "      <mode>automatic</mode>",
    "    </outbound>",
    "  </nat>",
    "  <revision>",
    `    <time>${revisionTime}</time>`,
    "    <description>Generated by iscan qemu kit</description>",
    "    <username>iscan</username>",
    "  </revision>",
    "</opnsense>",
  ].join("\n");
}

async function ensureRouterImportBundle(
  routerNetwork: Required<QemuRouterNetworkConfig>,
): Promise<void> {
  const confDirectory = path.join(routerNetwork.importDirectory, "conf");
  await fs.mkdir(confDirectory, { recursive: true });
  await fs.writeFile(
    path.join(confDirectory, "config.xml"),
    buildRouterConfigXml(routerNetwork),
  );
}

function resolveAbsolutePath(value: string, label: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(process.cwd(), normalized);
}

function hasArgPair(
  args: readonly string[],
  flag: string,
  valuePattern: RegExp,
): boolean {
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === flag && valuePattern.test(args[index + 1] ?? "")) {
      return true;
    }
  }

  return false;
}

function hasManagedPointerDevice(args: readonly string[]): boolean {
  return (
    args.some((arg) =>
      /(?:^|[,=])(usb-tablet|usb-mouse|virtio-tablet(?:-pci|-device)?|virtio-mouse(?:-pci|-device)?)(?:$|[,=])/u.test(
        arg,
      ),
    ) ||
    hasArgPair(
      args,
      "-device",
      /^(usb-tablet|usb-mouse|virtio-tablet(?:-pci|-device)?|virtio-mouse(?:-pci|-device)?)(?:,|$)/u,
    ) ||
    hasArgPair(args, "-usbdevice", /^(tablet|mouse)(?:$|,)/u)
  );
}

function hasUsbController(args: readonly string[]): boolean {
  return (
    args.includes("-usb") ||
    args.some((arg) =>
      /(?:^|[,=])(qemu-xhci|nec-usb-xhci|ich9-usb-ehci1|piix3-usb-uhci)(?:$|[,=])/u.test(
        arg,
      ),
    ) ||
    hasArgPair(
      args,
      "-device",
      /^(qemu-xhci|nec-usb-xhci|ich9-usb-ehci1|piix3-usb-uhci)(?:,|$)/u,
    )
  );
}

function hasManagedImportDrive(
  args: readonly string[],
  importDirectory: string,
): boolean {
  return args.some((arg) => arg.includes(`fat:rw:${importDirectory}`));
}

function isManagedRouterLanNetdev(value: string): boolean {
  return /^(?:socket,id=lan0(?:,|$)|tap,id=(?:lan0|lan)(?:,|$))/u.test(value);
}

function isManagedRouterLanDevice(value: string): boolean {
  return /^(?:e1000|virtio-net-pci),netdev=(?:lan0|lan)(?:,|$)/u.test(value);
}

function isManagedRouterWanNetdev(value: string): boolean {
  return /^user,id=(?:wan0|wan)(?:,|$)/u.test(value);
}

function isManagedRouterWanDevice(value: string): boolean {
  return /^e1000,netdev=(?:wan0|wan)(?:,|$)/u.test(value);
}

function extractTapInterfaceIndex(args: readonly string[] | undefined): number | null {
  if (!args) {
    return null;
  }

  for (const arg of args) {
    const match = /(?:^|,)ifname=tap(\d+)(?:,|$)/u.exec(arg);
    if (!match) {
      continue;
    }

    const tapIndex = Number(match[1]);
    if (Number.isInteger(tapIndex) && tapIndex >= 0) {
      return tapIndex;
    }
  }

  return null;
}

function replaceTapInterfaceIndex(
  args: readonly string[] | undefined,
  nextTapIndex: number,
): string[] | undefined {
  if (!args) {
    return undefined;
  }

  let changed = false;
  const replacedArgs = args.map((arg) => {
    const nextArg = arg.replace(
      /((?:^|,)ifname=)tap\d+((?:,|$))/u,
      `$1tap${nextTapIndex}$2`,
    );
    if (nextArg !== arg) {
      changed = true;
    }

    return nextArg;
  });

  return changed ? replacedArgs : [...args];
}

function resolveTapInterfaceConflicts(presets: readonly QemuVmPreset[]): QemuVmPreset[] {
  const resolvedPresets = presets.map((preset) => ({
    ...preset,
    routerNetwork: preset.routerNetwork ? { ...preset.routerNetwork } : undefined,
    args: preset.args ? [...preset.args] : undefined,
  }));
  const usedTapIndices = new Set<number>();

  for (const preset of resolvedPresets) {
    if (preset.role !== "router") {
      continue;
    }

    const tapIndex = extractTapInterfaceIndex(preset.args);
    if (tapIndex !== null) {
      usedTapIndices.add(tapIndex);
    }
  }

  let nextClientTapIndex = 1;
  const allocateNextClientTapIndex = (): number => {
    while (usedTapIndices.has(nextClientTapIndex)) {
      nextClientTapIndex += 1;
    }

    const allocatedTapIndex = nextClientTapIndex;
    usedTapIndices.add(allocatedTapIndex);
    nextClientTapIndex += 1;
    return allocatedTapIndex;
  };

  return resolvedPresets.map((preset) => {
    if (preset.role === "router") {
      return preset;
    }

    const tapIndex = extractTapInterfaceIndex(preset.args);
    if (tapIndex === null) {
      return preset;
    }

    if (tapIndex >= 1 && !usedTapIndices.has(tapIndex)) {
      usedTapIndices.add(tapIndex);
      nextClientTapIndex = Math.max(nextClientTapIndex, tapIndex + 1);
      return preset;
    }

    return {
      ...preset,
      args: replaceTapInterfaceIndex(preset.args, allocateNextClientTapIndex()),
    };
  });
}

function normalizeManagedRouterArgs(args: readonly string[]): string[] {
  type ManagedArgPair = {
    index: number;
    value: string;
  };

  let lanNetdev: ManagedArgPair | undefined;
  let lanDevice: ManagedArgPair | undefined;
  let wanNetdev: ManagedArgPair | undefined;
  let wanDevice: ManagedArgPair | undefined;

  for (let index = 0; index < args.length - 1; index += 1) {
    const flag = args[index];
    const value = args[index + 1] ?? "";

    if (flag === "-netdev") {
      if (!lanNetdev && isManagedRouterLanNetdev(value)) {
        lanNetdev = { index, value };
        continue;
      }

      if (!wanNetdev && isManagedRouterWanNetdev(value)) {
        wanNetdev = { index, value };
      }

      continue;
    }

    if (flag !== "-device") {
      continue;
    }

    if (!lanDevice && isManagedRouterLanDevice(value)) {
      lanDevice = { index, value };
      continue;
    }

    if (!wanDevice && isManagedRouterWanDevice(value)) {
      wanDevice = { index, value };
    }
  }

  if (!lanNetdev || !lanDevice || !wanNetdev || !wanDevice) {
    return [...args];
  }

  const firstManagedIndex = Math.min(
    lanNetdev.index,
    lanDevice.index,
    wanNetdev.index,
    wanDevice.index,
  );
  const skippedIndices = new Set([
    lanNetdev.index,
    lanNetdev.index + 1,
    lanDevice.index,
    lanDevice.index + 1,
    wanNetdev.index,
    wanNetdev.index + 1,
    wanDevice.index,
    wanDevice.index + 1,
  ]);
  const normalizedArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (index === firstManagedIndex) {
      normalizedArgs.push(
        "-netdev",
        ROUTER_MANAGED_WAN_NETDEV,
        "-device",
        ROUTER_MANAGED_WAN_DEVICE,
        "-netdev",
        ROUTER_MANAGED_LAN_NETDEV,
        "-device",
        ROUTER_MANAGED_LAN_DEVICE,
      );
    }

    if (skippedIndices.has(index)) {
      continue;
    }

    normalizedArgs.push(args[index]!);
  }

  return normalizedArgs;
}

function hasVirtioSerialController(args: readonly string[]): boolean {
  return (
    args.some((arg) =>
      /(?:^|[,=])(virtio-serial(?:-pci|-device)?)(?:$|[,=])/u.test(arg),
    ) ||
    hasArgPair(args, "-device", /^(virtio-serial(?:-pci|-device)?)(?:,|$)/u)
  );
}

function hasClipboardAgentChannel(args: readonly string[]): boolean {
  return (
    args.some(
      (arg) =>
        arg.includes("qemu-vdagent") || arg.includes("com.redhat.spice.0"),
    ) ||
    hasArgPair(args, "-chardev", /^qemu-vdagent(?:,|$)/u) ||
    hasArgPair(
      args,
      "-device",
      /^virtserialport(?:,.*name=com\.redhat\.spice\.0|,|$)/u,
    )
  );
}

function hasBootConfiguration(args: readonly string[]): boolean {
  return args.includes("-boot");
}

function shouldUseManagedDiskFirstBoot(
  spec: QemuLaunchSpec,
  args: readonly string[],
): boolean {
  return (
    Boolean(spec.diskImage) &&
    Boolean(spec.cdrom) &&
    !spec.kernel &&
    !spec.initrd &&
    !hasBootConfiguration(args)
  );
}

function buildEnvironment(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      environment[key] = value;
    }
  }

  return {
    ...environment,
    ...overrides,
  };
}

async function readOutput(
  stream: ReadableStream<Uint8Array> | null | undefined,
): Promise<string> {
  if (!stream) {
    return "";
  }

  const output = await new Response(stream).arrayBuffer();
  return Buffer.from(output).toString("utf8").trim();
}

async function runCommand(
  command: readonly string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<QemuCommandResult> {
  const child = Bun.spawn({
    cmd: [...command],
    cwd: options.cwd ?? process.cwd(),
    env: buildEnvironment(options.env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    readOutput(child.stdout),
    readOutput(child.stderr),
  ]);

  return {
    command,
    exitCode,
    stdout,
    stderr,
  };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function allocateEphemeralPort(): Promise<number> {
  const server = net.createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  if (!Number.isInteger(port) || port < 1) {
    throw new Error(
      "Unable to allocate a temporary port for router bootstrap.",
    );
  }

  return port;
}

function updateCookieJar(
  cookieJar: Map<string, string>,
  headers: Record<string, string | string[] | undefined>,
): void {
  const setCookieHeader = headers["set-cookie"];
  const values = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : typeof setCookieHeader === "string"
      ? [setCookieHeader]
      : [];

  for (const value of values) {
    const cookie = value.split(";", 1)[0]?.trim();
    if (!cookie) {
      continue;
    }

    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();
    const cookieValue = cookie.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }

    cookieJar.set(name, cookieValue);
  }
}

function buildCookieHeader(cookieJar: Map<string, string>): string | undefined {
  if (cookieJar.size === 0) {
    return undefined;
  }

  return [...cookieJar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function requestHttps(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
  } = {},
): Promise<SimpleHttpsResponse> {
  const target = new URL(url);

  return await new Promise<SimpleHttpsResponse>((resolve, reject) => {
    const requestModule = target.protocol === "http:" ? http : https;
    const requestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method ?? "GET",
      headers: options.headers,
      ...(target.protocol === "https:"
        ? { agent: new https.Agent({ rejectUnauthorized: false }) }
        : {}),
    };
    const request = requestModule.request(
      requestOptions,
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    request.on("error", reject);

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

function parseHtmlAttribute(tag: string, attributeName: string): string | null {
  const match = tag.match(
    new RegExp(`\\b${attributeName}=("([^"]*)"|'([^']*)')`, "iu"),
  );
  return match?.[2] ?? match?.[3] ?? null;
}

function parseCsrfToken(
  html: string,
  context: "login" | "restore",
): { name: string; value: string } {
  const firstFormStart = html.search(
    /<form\b[^>]*method=("post"|'post')[^>]*>/iu,
  );
  const formScopedHtml =
    firstFormStart >= 0
      ? html.slice(
          firstFormStart,
          html.indexOf("</form>", firstFormStart) >= 0
            ? html.indexOf("</form>", firstFormStart)
            : undefined,
        )
      : html;

  const hiddenInputMatches = formScopedHtml.match(/<input\b[^>]*>/giu) ?? [];
  const hiddenInputs = hiddenInputMatches
    .map((tag) => ({
      type: parseHtmlAttribute(tag, "type")?.toLowerCase(),
      name: parseHtmlAttribute(tag, "name"),
      value: parseHtmlAttribute(tag, "value"),
    }))
    .filter(
      (input): input is { type: string; name: string; value: string } =>
        input.type === "hidden" && Boolean(input.name) && Boolean(input.value),
    );

  const csrfInput = hiddenInputs.find(
    (input) =>
      input.name.toLowerCase().includes("csrf") ||
      input.value.toLowerCase().includes("sid:"),
  );

  if (csrfInput) {
    return {
      name: csrfInput.name,
      value: csrfInput.value,
    };
  }

  const firstHiddenInput = hiddenInputs[0];
  if (firstHiddenInput) {
    return {
      name: firstHiddenInput.name,
      value: firstHiddenInput.value,
    };
  }

  throw new Error(`Unable to extract the OPNsense ${context} CSRF token.`);
}

function buildMultipartForm(
  fields: Record<string, string>,
  fileField: {
    name: string;
    filename: string;
    contentType: string;
    content: Buffer;
  },
): { contentType: string; body: Buffer } {
  const boundary = `----iscan-${crypto.randomUUID()}`;
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`),
    );
    chunks.push(Buffer.from(value));
    chunks.push(Buffer.from("\r\n"));
  }

  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(
    Buffer.from(
      `Content-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\n`,
    ),
  );
  chunks.push(Buffer.from(`Content-Type: ${fileField.contentType}\r\n\r\n`));
  chunks.push(fileField.content);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks),
  };
}

function extractGuestfishRootDevice(output: string): string | undefined {
  return output
    .split(/\s+/u)
    .map((segment) => segment.trim())
    .find(Boolean);
}

function detectRouterBootstrapStateFromConfigXml(
  configXml: string,
): QemuRouterBootstrapState {
  if (
    /<trigger_initial_wizard\s*\/>/u.test(configXml) ||
    /<trigger_initial_wizard>[\s\S]*?<\/trigger_initial_wizard>/u.test(
      configXml,
    )
  ) {
    return {
      status: "needs-bootstrap",
      reason:
        "The installed router still contains the factory initial wizard marker.",
    };
  }

  const hasLanDhcp =
    /<dhcpd>[\s\S]*?<lan>[\s\S]*?<range>[\s\S]*?<from>[^<]+<\/from>[\s\S]*?<to>[^<]+<\/to>/u.test(
      configXml,
    );
  if (!hasLanDhcp) {
    return {
      status: "needs-bootstrap",
      reason:
        "The installed router config does not contain the LAN DHCP range yet.",
    };
  }

  const hasWanWebRule =
    /<filter>[\s\S]*?<rule>[\s\S]*?<interface>wan<\/interface>[\s\S]*?<protocol>tcp<\/protocol>[\s\S]*?<destination>[\s\S]*?<port>80<\/port>/u.test(
      configXml,
    );
  if (!hasWanWebRule) {
    return {
      status: "needs-bootstrap",
      reason:
        "The installed router config does not contain the WAN web UI access rule yet.",
    };
  }

  const blocksPrivateWanNetwork =
    /<interfaces>[\s\S]*?<wan>[\s\S]*?<blockpriv>1<\/blockpriv>/u.test(
      configXml,
    );
  if (blocksPrivateWanNetwork) {
    return {
      status: "needs-bootstrap",
      reason:
        "The installed router WAN still blocks private networks, which breaks the QEMU user-mode uplink.",
    };
  }

  const hasHttpWebGuiProtocol =
    /<system>[\s\S]*?<webgui>[\s\S]*?<protocol>http<\/protocol>/u.test(
      configXml,
    );
  const hasHttpWebGuiPort =
    /<system>[\s\S]*?<webgui>[\s\S]*?<port>80<\/port>/u.test(configXml);
  if (!hasHttpWebGuiProtocol || !hasHttpWebGuiPort) {
    return {
      status: "needs-bootstrap",
      reason:
        "The installed router config does not expose the web UI on HTTP port 80 yet.",
    };
  }

  return {
    status: "bootstrapped",
    reason:
      "The installed router config contains the LAN DHCP range, WAN web UI access rule, and HTTP port 80 web GUI settings.",
  };
}

async function inspectRouterBootstrapState(
  diskImage: string | undefined,
): Promise<QemuRouterBootstrapState> {
  if (!diskImage || !existsSync(diskImage)) {
    return {
      status: "unknown",
      reason:
        "Router disk image is missing, so bootstrap state cannot be inspected.",
    };
  }

  const inspectResult = await runCommand([
    "guestfish",
    "--ro",
    "-a",
    diskImage,
    "run",
    ":",
    "inspect-os",
  ]);

  if (inspectResult.exitCode !== 0) {
    const inspectError = inspectResult.stderr || "guestfish inspect-os failed.";
    if (
      /Failed to get shared "write" lock|Is another process using the image/u.test(
        inspectError,
      )
    ) {
      return {
        status: "in-use",
        reason:
          "The router disk image is currently locked by a running QEMU process.",
      };
    }

    return {
      status: "unknown",
      reason: inspectError,
    };
  }

  const rootDevice = extractGuestfishRootDevice(inspectResult.stdout);
  if (!rootDevice) {
    return {
      status: "uninstalled",
      reason:
        "The router disk does not contain an installed OS yet. Boot the installer ISO first, then bootstrap can be applied.",
    };
  }

  const readResult = await runCommand([
    "guestfish",
    "--ro",
    "-a",
    diskImage,
    "run",
    ":",
    "mount-options",
    "rw,ufstype=ufs2",
    rootDevice,
    "/",
    ":",
    "cat",
    "/conf/config.xml",
  ]);

  if (readResult.exitCode !== 0 || !readResult.stdout.includes("<opnsense>")) {
    return {
      status: "unknown",
      reason:
        readResult.stderr ||
        "guestfish could not read /conf/config.xml from the router disk.",
    };
  }

  return detectRouterBootstrapStateFromConfigXml(readResult.stdout);
}

async function resolveRouterRootDevice(diskImage: string): Promise<string> {
  const inspectResult = await runCommand([
    "guestfish",
    "--ro",
    "-a",
    diskImage,
    "run",
    ":",
    "inspect-os",
  ]);

  if (inspectResult.exitCode !== 0) {
    throw new Error(inspectResult.stderr || "guestfish inspect-os failed.");
  }

  const rootDevice = extractGuestfishRootDevice(inspectResult.stdout);
  if (!rootDevice) {
    throw new Error(
      "guestfish could not determine the mounted root device for the router disk.",
    );
  }

  return rootDevice;
}

async function injectRouterConfigIntoDiskImage(
  diskImage: string,
  configPath: string,
): Promise<void> {
  const rootDevice = await resolveRouterRootDevice(diskImage);
  const uploadResult = await runCommand([
    "guestfish",
    "--rw",
    "-a",
    diskImage,
    "run",
    ":",
    "mount-options",
    "ufstype=ufs2",
    rootDevice,
    "/",
    ":",
    "upload",
    configPath,
    "/conf/config.xml",
  ]);

  if (uploadResult.exitCode !== 0) {
    throw new Error(
      uploadResult.stderr ||
        "guestfish could not write /conf/config.xml to the router disk.",
    );
  }
}

function buildRouterBootstrapHelperArgs(
  spec: QemuLaunchSpec,
  managementPort: number,
  pidFilePath: string,
): string[] {
  if (!spec.diskImage) {
    throw new Error("Router bootstrap requires a disk image.");
  }

  const diskInterface =
    normalizeDiskInterface(
      spec.diskInterface,
      "Qemu router bootstrap diskInterface",
    ) ?? "virtio";
  const memoryMb = normalizePositiveInteger(
    spec.memoryMb,
    "Qemu router bootstrap memoryMb",
  );
  const smp = normalizePositiveInteger(spec.smp, "Qemu router bootstrap smp");
  const args = [
    "-m",
    String(memoryMb ?? 2048),
    "-machine",
    spec.machine ?? "q35",
    "-drive",
    `file=${spec.diskImage},format=${spec.diskFormat ?? "qcow2"},if=${diskInterface}`,
    "-display",
    "none",
    "-daemonize",
    "-pidfile",
    pidFilePath,
    "-netdev",
    `user,id=lan0,net=${ROUTER_BOOTSTRAP_FACTORY_LAN_NETWORK},dhcpstart=${ROUTER_DEFAULT_DHCP_START},hostfwd=tcp:127.0.0.1:${managementPort}-${ROUTER_DEFAULT_LAN_ADDRESS}:80`,
    "-device",
    "e1000,netdev=lan0",
    "-netdev",
    "user,id=wan0",
    "-device",
    "e1000,netdev=wan0",
  ];

  const accelerator = spec.enableKvm === false ? undefined : spec.accelerator;
  if (accelerator) {
    args.push("-accel", accelerator);
  }

  if (spec.cpu) {
    args.push("-cpu", spec.cpu);
  }

  if (smp) {
    args.push("-smp", String(smp));
  }

  return args;
}

async function startRouterBootstrapHelper(
  qemuCommand: string,
  spec: QemuLaunchSpec,
  routerNetwork: Required<QemuRouterNetworkConfig>,
): Promise<QemuRouterBootstrapHelper> {
  const managementPort = await allocateEphemeralPort();
  const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "iscan-qemu-router-bootstrap-"),
  );
  const pidFilePath = path.join(tempDirectory, "qemu-bootstrap.pid");
  const command = [
    qemuCommand,
    ...buildRouterBootstrapHelperArgs(spec, managementPort, pidFilePath),
  ] as const;
  const result = await runCommand(command);

  if (result.exitCode !== 0) {
    await fs.rm(tempDirectory, { recursive: true, force: true });
    throw new Error(
      result.stderr ||
        `Unable to start the router bootstrap helper: ${command.join(" ")}`,
    );
  }

  return {
    baseUrl: `http://127.0.0.1:${managementPort}`,
    pidFilePath,
    tempDirectory,
  };
}

async function stopRouterBootstrapHelper(
  helper: QemuRouterBootstrapHelper | null | undefined,
): Promise<void> {
  if (!helper) {
    return;
  }

  try {
    const pidText = await fs.readFile(helper.pidFilePath, "utf8");
    const pid = Number(pidText.trim());
    if (Number.isInteger(pid) && pid > 1) {
      try {
        process.kill(pid);
      } catch {
        // Ignore already-exited helper processes.
      }
    }
  } catch {
    // Ignore missing pid files during cleanup.
  }

  await fs.rm(helper.tempDirectory, { recursive: true, force: true });
}

async function waitForRouterBootstrapUi(
  baseUrl: string,
): Promise<SimpleHttpsResponse> {
  const deadline = Date.now() + ROUTER_BOOTSTRAP_TIMEOUT_MS;
  let lastFailure = "Router bootstrap UI did not become reachable.";

  while (Date.now() < deadline) {
    try {
      const response = await requestHttps(baseUrl);
      if (
        response.statusCode === 200 &&
        response.body.includes("usernamefld")
      ) {
        return response;
      }

      lastFailure = `Unexpected bootstrap login response: HTTP ${response.statusCode}.`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    await delay(ROUTER_BOOTSTRAP_POLL_INTERVAL_MS);
  }

  throw new Error(lastFailure);
}

async function waitForRouterBootstrapReboot(baseUrl: string): Promise<void> {
  const deadline = Date.now() + ROUTER_BOOTSTRAP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await requestHttps(baseUrl);
      if (response.statusCode >= 500 || response.statusCode === 0) {
        return;
      }
    } catch {
      return;
    }

    await delay(ROUTER_BOOTSTRAP_POLL_INTERVAL_MS);
  }

  throw new Error(
    "Timed out waiting for the router bootstrap reboot to begin.",
  );
}

async function loginToRouterBootstrapUi(
  baseUrl: string,
  cookieJar: Map<string, string>,
  username: string,
  password: string,
  loginPage: SimpleHttpsResponse | null = null,
): Promise<void> {
  const resolvedLoginPage = loginPage ?? (await requestHttps(baseUrl));
  updateCookieJar(cookieJar, resolvedLoginPage.headers);
  const csrfToken = parseCsrfToken(resolvedLoginPage.body, "login");
  const loginBody = new URLSearchParams({
    [csrfToken.name]: csrfToken.value,
    usernamefld: username,
    passwordfld: password,
    login: "1",
  }).toString();
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    "content-length": String(Buffer.byteLength(loginBody)),
  };
  const cookieHeader = buildCookieHeader(cookieJar);
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }

  const response = await requestHttps(baseUrl, {
    method: "POST",
    headers,
    body: loginBody,
  });
  updateCookieJar(cookieJar, response.headers);

  if (![200, 302].includes(response.statusCode)) {
    throw new Error(
      `OPNsense bootstrap login failed with HTTP ${response.statusCode}.`,
    );
  }

  if (response.statusCode === 200 && response.body.includes("usernamefld")) {
    throw new Error(
      `OPNsense bootstrap login for '${username}' was rejected and the login form was returned again.`,
    );
  }
}

async function restoreRouterConfigThroughWebUi(
  baseUrl: string,
  cookieJar: Map<string, string>,
  configPath: string,
  rebootAfterRestore = false,
): Promise<void> {
  const cookieHeader = buildCookieHeader(cookieJar);
  const backupPageHeaders: Record<string, string> = {};
  if (cookieHeader) {
    backupPageHeaders.cookie = cookieHeader;
  }

  const backupPage = await requestHttps(`${baseUrl}/diag_backup.php`, {
    headers: backupPageHeaders,
  });
  updateCookieJar(cookieJar, backupPage.headers);

  if (backupPage.statusCode === 302) {
    throw new Error(
      `The router backup page redirected to ${backupPage.headers.location ?? "another location"} instead of returning the restore form.`,
    );
  }

  if (backupPage.body.includes("usernamefld")) {
    throw new Error(
      "The router backup page returned the login form again instead of the restore form.",
    );
  }

  const csrfToken = parseCsrfToken(backupPage.body, "restore");
  const restoreFields: Record<string, string> = {
    [csrfToken.name]: csrfToken.value,
    restore: "Restore configuration",
    keepconsole: "on",
  };
  if (rebootAfterRestore) {
    restoreFields.rebootafterrestore = "on";
  }

  const multipart = buildMultipartForm(restoreFields, {
    name: "conffile",
    filename: path.basename(configPath),
    contentType: "text/xml",
    content: await fs.readFile(configPath),
  });
  const restoreHeaders: Record<string, string> = {
    "content-type": multipart.contentType,
    "content-length": String(multipart.body.length),
  };
  const restoreCookieHeader = buildCookieHeader(cookieJar);
  if (restoreCookieHeader) {
    restoreHeaders.cookie = restoreCookieHeader;
  }

  const response = await requestHttps(`${baseUrl}/diag_backup.php`, {
    method: "POST",
    headers: restoreHeaders,
    body: multipart.body,
  });
  updateCookieJar(cookieJar, response.headers);

  if (
    !response.body.includes("The configuration has been restored.") &&
    !response.body.includes("The system is rebooting now")
  ) {
    throw new Error(
      "OPNsense did not confirm that the router configuration was restored.",
    );
  }
}

export class QemuKit extends Kit {
  private static readonly activeInstances = new Set<QemuKit>();
  private static readonly processSignalHandlers = new Map<
    QemuTerminationSignal,
    () => void
  >();
  private static processExitHandler: (() => void) | null = null;
  private static shutdownInProgress = false;

  private readonly config: ResolvedQemuManifestConfig;
  private presets: QemuVmPreset[] = [];
  private readonly presetsPath: string;
  private readonly runningProcesses = new Set<ReturnType<typeof Bun.spawn>>();
  private readonly trackedProcessMetadata = new Map<
    number,
    QemuTrackedProcessMetadata
  >();

  constructor(options: QemuKitOptions = {}) {
    super(QEMU_KIT_INFO);

    const manifestConfig = $manifest.getQemuConfig();
    this.config = {
      ...withDefinedOverrides(manifestConfig, options),
      memoryMb:
        normalizePositiveInteger(
          options.memoryMb ?? manifestConfig.memoryMb,
          "QemuKit memoryMb",
        ) ?? manifestConfig.memoryMb,
      defaultArgs: options.defaultArgs
        ? [...options.defaultArgs]
        : [...manifestConfig.defaultArgs],
    };
    this.presetsPath = path.join(process.cwd(), ".iscan", "qemu-presets.json");
  }

  getConfig(): ResolvedQemuManifestConfig {
    return {
      ...this.config,
      defaultArgs: [...this.config.defaultArgs],
    };
  }

  getConnectionSummary(): string {
    return [
      `${this.config.systemDependencyId}`,
      `${this.config.architecture}`,
      `${this.config.memoryMb}MB`,
      this.config.useProxy ? "proxychains" : "direct",
    ].join(" • ");
  }

  getRunningProcessCount(): number {
    return this.trackedProcessMetadata.size;
  }

  inspectEnvironment(): QemuKitEnvironmentReport {
    return {
      config: this.getConfig(),
      system: $manifest.refreshDependency(this.config.systemDependencyId),
      imageTool: $manifest.refreshDependency(this.config.imageDependencyId),
      proxy: $manifest.refreshDependency(this.config.proxyDependencyId),
      runningProcessCount: this.getRunningProcessCount(),
    };
  }

  override async onStart(_context: KitLifecycleContext): Promise<void> {
    await this.loadPresets();
    this.ensureDependencies({ useProxy: this.config.useProxy });
    QemuKit.activeInstances.add(this);
    QemuKit.installProcessTerminationHooks();
  }

  override async onStop(_context: KitLifecycleContext): Promise<void> {
    QemuKit.activeInstances.delete(this);
    if (QemuKit.activeInstances.size === 0) {
      QemuKit.uninstallProcessTerminationHooks();
    }

    await this.stopTrackedProcesses();
  }

  getPresets(): QemuVmPreset[] {
    return this.presets.map((preset) => this.clonePreset(preset));
  }

  createLaunchSpecFromPreset(preset: QemuVmPreset): QemuLaunchSpec {
    const { id: _id, name: _name, role: _role, ...spec } = preset;
    return {
      ...spec,
      routerNetwork: preset.routerNetwork
        ? { ...preset.routerNetwork }
        : undefined,
      args: preset.args ? [...preset.args] : undefined,
    };
  }

  previewPreset(target: string): QemuCommandPreview {
    const preset = this.resolvePreset(target);
    return this.buildCommand(this.createLaunchSpecFromPreset(preset));
  }

  async savePreset(preset: QemuVmPreset): Promise<void> {
    const normalizedPreset = this.normalizePreset(preset);
    const index = this.presets.findIndex(
      (existingPreset) => existingPreset.id === normalizedPreset.id,
    );
    if (index >= 0) {
      this.presets[index] = normalizedPreset;
    } else {
      this.presets.push(normalizedPreset);
    }

    this.presets = resolveTapInterfaceConflicts(this.presets);

    await this.persistPresets();
  }

  async deletePreset(target: string): Promise<void> {
    const preset = this.resolvePreset(target);
    this.presets = this.presets.filter(
      (existingPreset) => existingPreset.id !== preset.id,
    );
    await this.persistPresets();
  }

  async launchPreset(
    target: string,
    options: QemuSpawnOptions = {},
  ): Promise<ReturnType<typeof Bun.spawn>> {
    const preset = this.resolvePreset(target);
    return this.launch(this.createLaunchSpecFromPreset(preset), options);
  }

  async prepareRouterInstallerIso(
    target: string,
    options: QemuPrepareInstallerIsoOptions = {},
  ): Promise<QemuPrepareInstallerIsoResult> {
    const preset = this.resolvePreset(target);
    if (preset.role !== "router") {
      throw new Error(
        `QEMU installer preparation is only supported for router presets. Preset '${preset.name}' is not a router.`,
      );
    }

    const routerNetwork = normalizeRouterNetworkConfig(
      preset.routerNetwork,
      "Qemu preset routerNetwork",
      preset.name,
    );
    if (
      !routerNetwork?.hostname ||
      !routerNetwork.domain ||
      !routerNetwork.wanInterface ||
      !routerNetwork.lanInterface ||
      !routerNetwork.lanAddress ||
      !routerNetwork.lanPrefix ||
      !routerNetwork.dhcpStart ||
      !routerNetwork.dhcpEnd ||
      !routerNetwork.importDirectory
    ) {
      throw new Error(
        `Router preset '${preset.name}' is missing managed routerNetwork settings required to build config.xml.`,
      );
    }

    await ensureRouterImportBundle(
      routerNetwork as Required<QemuRouterNetworkConfig>,
    );

    const sourceIsoPath = resolveAbsolutePath(
      options.sourceIsoPath ?? preset.cdrom ?? "",
      "Router installer ISO path",
    );
    const outputIsoPath = resolveAbsolutePath(
      options.outputIsoPath ?? buildPreparedRouterInstallerIsoPath(preset.name),
      "Prepared installer ISO output path",
    );
    const configPath = path.join(routerNetwork.importDirectory, "conf", "config.xml");
    const overwritten = existsSync(outputIsoPath);

    if (sourceIsoPath === outputIsoPath) {
      throw new Error(
        "Prepared installer ISO output path must differ from the source installer ISO path.",
      );
    }

    if (overwritten && !options.overwrite) {
      throw new Error(
        `Prepared installer ISO already exists: ${outputIsoPath}. Pass overwrite=true to replace it.`,
      );
    }

    await fs.mkdir(path.dirname(outputIsoPath), { recursive: true });
    if (overwritten) {
      await fs.rm(outputIsoPath, { force: true });
    }

    const result = await runCommand(
      [
        $manifest.resolveDependencyCommand(
          "xorriso",
          "xorriso is required to prepare a reusable OPNsense installer ISO",
        ),
        "-indev",
        sourceIsoPath,
        "-outdev",
        outputIsoPath,
        "-boot_image",
        "any",
        "replay",
        "-map",
        configPath,
        ROUTER_INSTALLER_EMBEDDED_CONFIG_PATH,
        "-chmod",
        "0444",
        ROUTER_INSTALLER_EMBEDDED_CONFIG_PATH,
        "--",
        "-commit",
        "-end",
      ],
      { cwd: process.cwd() },
    );

    if (result.exitCode !== 0) {
      const details = result.stderr || result.stdout || "No output.";
      throw new Error(
        `xorriso failed to prepare installer ISO with exit code ${result.exitCode}.\n${details}`,
      );
    }

    return {
      presetId: preset.id,
      presetName: preset.name,
      sourceIsoPath,
      outputIsoPath,
      configPath,
      embeddedConfigPath: ROUTER_INSTALLER_EMBEDDED_CONFIG_PATH,
      overwritten,
    };
  }

  async inspectPresetBootstrapState(
    target: string,
  ): Promise<QemuRouterBootstrapState | null> {
    const preset = this.resolvePreset(target);
    if (preset.role !== "router") {
      return null;
    }

    return await inspectRouterBootstrapState(preset.diskImage);
  }

  async bootstrapPreset(
    target: string,
    options: QemuRouterBootstrapOptions = {},
  ): Promise<QemuRouterBootstrapResult> {
    let preset = this.resolvePreset(target);
    if (preset.role !== "router") {
      throw new Error(
        `QEMU bootstrap is only supported for router presets. Preset '${preset.name}' is not a router.`,
      );
    }

    const steps: QemuRouterBootstrapProgress[] = [];
    const emit = (
      stage: QemuRouterBootstrapProgress["stage"],
      message: string,
    ): void => {
      const progress: QemuRouterBootstrapProgress = {
        stage,
        message,
        createdAt: Date.now(),
      };
      steps.push(progress);
      options.onProgress?.(progress);
    };

    emit("inspect", `Inspecting router disk state for ${preset.name}`);
    const initialState = await inspectRouterBootstrapState(preset.diskImage);
    emit("inspect", initialState.reason);

    const updatedPreset = await this.maybeDetachRouterInstallerMedia(
      preset,
      initialState,
    );
    const detachedInstallerMedia =
      Boolean(preset.cdrom) && !updatedPreset.cdrom;
    preset = updatedPreset;
    if (detachedInstallerMedia) {
      emit(
        "detach-installer",
        `Detached installer ISO from router preset ${preset.name} because an installed system was detected.`,
      );
    }

    if (initialState.status === "bootstrapped") {
      emit("skip", "Bootstrap is already applied; nothing to do.");
      return {
        presetId: preset.id,
        presetName: preset.name,
        initialState,
        finalState: initialState,
        detachedInstallerMedia,
        rebootRequested: Boolean(options.rebootAfterRestore),
        skipped: true,
        steps,
      };
    }

    if (initialState.status === "uninstalled") {
      emit("skip", initialState.reason);
      return {
        presetId: preset.id,
        presetName: preset.name,
        initialState,
        finalState: initialState,
        detachedInstallerMedia,
        rebootRequested: Boolean(options.rebootAfterRestore),
        skipped: true,
        steps,
      };
    }

    if (initialState.status === "in-use") {
      emit("skip", initialState.reason);
      return {
        presetId: preset.id,
        presetName: preset.name,
        initialState,
        finalState: initialState,
        detachedInstallerMedia,
        rebootRequested: Boolean(options.rebootAfterRestore),
        skipped: true,
        steps,
      };
    }

    if (initialState.status === "unknown") {
      emit("skip", initialState.reason);
      if (options.throwOnUnknown ?? true) {
        throw new Error(
          `Unable to bootstrap router preset ${preset.name}: ${initialState.reason}`,
        );
      }

      return {
        presetId: preset.id,
        presetName: preset.name,
        initialState,
        finalState: initialState,
        detachedInstallerMedia,
        rebootRequested: Boolean(options.rebootAfterRestore),
        skipped: true,
        steps,
      };
    }

    await this.maybeBootstrapRouterPreset(preset, initialState, {
      onProgress: (progress) => {
        steps.push(progress);
        options.onProgress?.(progress);
      },
      username: options.username,
      password: options.password,
      rebootAfterRestore: options.rebootAfterRestore,
    });
    const finalState = await inspectRouterBootstrapState(preset.diskImage);
    emit("complete", finalState.reason);

    return {
      presetId: preset.id,
      presetName: preset.name,
      initialState,
      finalState,
      detachedInstallerMedia,
      rebootRequested: Boolean(options.rebootAfterRestore),
      skipped: false,
      steps,
    };
  }

  buildVmArgs(spec: QemuLaunchSpec = {}): string[] {
    const memoryMb =
      normalizePositiveInteger(
        spec.memoryMb ?? this.config.memoryMb,
        "Qemu launch memoryMb",
      ) ?? this.config.memoryMb;
    const smp = normalizePositiveInteger(spec.smp, "Qemu launch smp");
    const routerNetwork = normalizeRouterNetworkConfig(
      spec.routerNetwork,
      "Qemu launch routerNetwork",
    );
    const extraArgs = routerNetwork
      ? normalizeManagedRouterArgs([
          ...this.config.defaultArgs,
          ...(spec.args ?? []),
        ])
      : [...this.config.defaultArgs, ...(spec.args ?? [])];
    const managedRouterLaunch = Boolean(routerNetwork);
    const machine = spec.machine ?? this.config.machine;
    const args: string[] = ["-m", String(memoryMb)];

    if (!(managedRouterLaunch && machine === this.config.machine && machine === "q35")) {
      args.push("-machine", machine);
    }

    const accelerator =
      spec.enableKvm === false
        ? undefined
        : (spec.accelerator ?? this.config.accelerator);
    if (accelerator) {
      if (managedRouterLaunch && accelerator === "kvm") {
        args.push("-enable-kvm");
      } else {
        args.push("-accel", accelerator);
      }
    }

    if (spec.cpu) {
      args.push("-cpu", spec.cpu);
    }

    if (smp) {
      args.push("-smp", String(smp));
    }

    if (spec.diskImage) {
      const diskInterface =
        normalizeDiskInterface(
          spec.diskInterface,
          "Qemu launch diskInterface",
        ) ?? "virtio";
      args.push(
        "-drive",
        `file=${spec.diskImage},format=${spec.diskFormat ?? "qcow2"},if=${diskInterface}`,
      );
    }

    if (spec.cdrom) {
      args.push("-cdrom", spec.cdrom);
    }

    if (shouldUseManagedDiskFirstBoot(spec, extraArgs)) {
      // Prefer the installed disk once it becomes bootable, but still fall back to the ISO during initial installation.
      args.push("-boot", "order=cd");
    }

    if (spec.kernel) {
      args.push("-kernel", spec.kernel);
    }

    if (spec.initrd) {
      args.push("-initrd", spec.initrd);
    }

    if (spec.append) {
      args.push("-append", spec.append);
    }

    if (spec.snapshot) {
      args.push("-snapshot");
    }

    if (spec.headless) {
      args.push("-nographic");
    }

    if (spec.daemonize) {
      args.push("-daemonize");
    }

    if (!managedRouterLaunch && !spec.headless && !hasManagedPointerDevice(extraArgs)) {
      if (!hasUsbController(extraArgs)) {
        args.push("-usb");
      }

      args.push("-device", "usb-tablet");
    }

    if (!managedRouterLaunch && !spec.headless && !hasClipboardAgentChannel(extraArgs)) {
      if (!hasVirtioSerialController(extraArgs)) {
        args.push("-device", "virtio-serial-pci");
      }

      args.push(
        "-chardev",
        "qemu-vdagent,id=iscan-vdagent,clipboard=on,mouse=off",
        "-device",
        "virtserialport,chardev=iscan-vdagent,name=com.redhat.spice.0",
      );
    }

    args.push(...extraArgs);
    return args;
  }

  buildCommand(spec: QemuLaunchSpec = {}): QemuCommandPreview {
    const usesProxy = spec.useProxy ?? this.config.useProxy;
    const command: string[] = [];

    if (usesProxy) {
      command.push(
        $manifest.resolveDependencyCommand(
          this.config.proxyDependencyId,
          "Proxychains is required for QemuKit",
        ),
      );
    }

    command.push(
      $manifest.resolveDependencyCommand(
        this.config.systemDependencyId,
        "QEMU system binary is required for QemuKit",
      ),
      ...this.buildVmArgs(spec),
    );

    return {
      command,
      usesProxy,
    };
  }

  launch(
    spec: QemuLaunchSpec = {},
    options: QemuSpawnOptions = {},
  ): ReturnType<typeof Bun.spawn> {
    const preview = this.buildCommand(spec);
    const managedTapNetwork = ensureManagedTapNetworkingSync(preview.command);
    const daemonTracking = spec.daemonize ? createDaemonLaunchTracking() : null;
    const command = daemonTracking
      ? this.appendPidFileToCommand(preview.command, daemonTracking.pidFilePath)
      : [...preview.command];
    let child: ReturnType<typeof Bun.spawn>;

    try {
      child = Bun.spawn({
        cmd: command,
        cwd: options.cwd ?? process.cwd(),
        env: buildEnvironment(options.env),
        stdin: options.stdin ?? "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
    } catch (error) {
      cleanupManagedTapNetworkingSync(managedTapNetwork ?? undefined);
      throw error;
    }

    this.trackSpawnedProcess(child, {
      metadata: daemonTracking ? undefined : { managedTapNetwork: managedTapNetwork ?? undefined },
      removeArtifactsOnExit: !daemonTracking,
    });
    if (daemonTracking) {
      void this.trackDaemonizedLaunch(child, daemonTracking, managedTapNetwork);
    }

    return child;
  }

  async run(
    spec: QemuLaunchSpec = {},
    options: Omit<QemuSpawnOptions, "stdin"> = {},
  ): Promise<QemuCommandResult> {
    const preview = this.buildCommand(spec);
    const result = await runCommand(preview.command, {
      cwd: options.cwd,
      env: options.env,
    });

    return result;
  }

  async createDiskImage(spec: QemuDiskImageSpec): Promise<QemuCommandResult> {
    if (!spec.overwrite && existsSync(spec.path)) {
      throw new Error(`QEMU disk image already exists: ${spec.path}`);
    }

    await fs.mkdir(path.dirname(spec.path), { recursive: true });

    const command = [
      $manifest.resolveDependencyCommand(
        this.config.imageDependencyId,
        "qemu-img is required to create disk images",
      ),
      "create",
      "-f",
      spec.format ?? "qcow2",
      spec.path,
      spec.size,
    ];

    const result = await runCommand(command, {
      cwd: spec.cwd,
      env: spec.env,
    });

    if (result.exitCode !== 0) {
      const details = result.stderr || result.stdout || "No output.";
      throw new Error(
        `qemu-img create failed with exit code ${result.exitCode}.\n${details}`,
      );
    }

    return result;
  }

  async copyDiskImage(spec: QemuDiskCopySpec): Promise<void> {
    const sourcePath = resolveAbsolutePath(spec.sourcePath, "QEMU base disk image");
    const destinationPath = resolveAbsolutePath(spec.path, "QEMU disk image path");

    if (!existsSync(sourcePath)) {
      throw new Error(`QEMU base disk image does not exist: ${sourcePath}`);
    }

    if (!spec.overwrite && existsSync(destinationPath)) {
      throw new Error(`QEMU disk image already exists: ${destinationPath}`);
    }

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }

  private ensureDependencies(options: { useProxy: boolean }): void {
    $manifest.assertDependency(
      this.config.systemDependencyId,
      "QEMU system binary is required for QemuKit startup",
    );
    $manifest.assertDependency(
      this.config.imageDependencyId,
      "qemu-img is required for QemuKit image operations",
    );
    if (options.useProxy) {
      $manifest.assertDependency(
        this.config.proxyDependencyId,
        "Proxychains is required because QemuKit proxy mode is enabled",
      );
    }
  }

  private static installProcessTerminationHooks(): void {
    if (!QemuKit.processExitHandler) {
      QemuKit.processExitHandler = () => {
        QemuKit.terminateActiveInstancesSync();
      };
      process.on("exit", QemuKit.processExitHandler);
    }

    if (QemuKit.processSignalHandlers.size > 0) {
      return;
    }

    for (const signal of QEMU_TERMINATION_SIGNALS) {
      const handler = () => {
        QemuKit.handleTerminationSignal(signal);
      };
      QemuKit.processSignalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
  }

  private static uninstallProcessTerminationHooks(): void {
    if (QemuKit.processExitHandler) {
      process.off("exit", QemuKit.processExitHandler);
      QemuKit.processExitHandler = null;
    }

    for (const [signal, handler] of QemuKit.processSignalHandlers) {
      process.off(signal, handler);
    }

    QemuKit.processSignalHandlers.clear();
  }

  private static handleTerminationSignal(signal: QemuTerminationSignal): void {
    if (QemuKit.shutdownInProgress) {
      return;
    }

    QemuKit.shutdownInProgress = true;
    QemuKit.terminateActiveInstancesSync();
    QemuKit.uninstallProcessTerminationHooks();

    try {
      process.kill(process.pid, signal);
      return;
    } catch {
      process.exit(QEMU_TERMINATION_EXIT_CODES[signal]);
    }
  }

  private static terminateActiveInstancesSync(): void {
    for (const kit of QemuKit.activeInstances) {
      kit.terminateTrackedProcessesSync();
    }
  }

  private appendPidFileToCommand(
    command: readonly string[],
    pidFilePath: string,
  ): string[] {
    const nextCommand = [...command];
    const daemonizeIndex = nextCommand.indexOf("-daemonize");
    if (daemonizeIndex >= 0) {
      nextCommand.splice(daemonizeIndex, 0, "-pidfile", pidFilePath);
      return nextCommand;
    }

    nextCommand.push("-pidfile", pidFilePath);
    return nextCommand;
  }

  private trackProcessId(
    pid: number,
    metadata: QemuTrackedProcessMetadata = {},
  ): void {
    if (!Number.isInteger(pid) || pid < 2) {
      return;
    }

    const currentMetadata = this.trackedProcessMetadata.get(pid);
    this.trackedProcessMetadata.set(pid, {
      ...currentMetadata,
      ...metadata,
    });
  }

  private async untrackProcessId(
    pid: number,
    options: { removeArtifacts?: boolean } = {},
  ): Promise<void> {
    const metadata = this.trackedProcessMetadata.get(pid);
    if (!metadata) {
      return;
    }

    this.trackedProcessMetadata.delete(pid);
    if (options.removeArtifacts) {
      await removeTrackingArtifacts(metadata);
    }
  }

  private trackSpawnedProcess(
    child: ReturnType<typeof Bun.spawn>,
    options: {
      metadata?: QemuTrackedProcessMetadata;
      removeArtifactsOnExit?: boolean;
    } = {},
  ): void {
    this.runningProcesses.add(child);
    this.trackProcessId(child.pid, options.metadata);

    void child.exited.finally(() => {
      this.runningProcesses.delete(child);
      void this.untrackProcessId(child.pid, {
        removeArtifacts: options.removeArtifactsOnExit,
      });
    });
  }

  private async trackDaemonizedLaunch(
    child: ReturnType<typeof Bun.spawn>,
    tracking: QemuDaemonLaunchTracking,
    managedTapNetwork: QemuManagedTapNetwork | null,
  ): Promise<void> {
    try {
      const pid = await waitForPidFile(
        tracking.pidFilePath,
        QEMU_DAEMON_PIDFILE_TIMEOUT_MS,
      );
      this.trackProcessId(pid, {
        ...tracking,
        managedTapNetwork: managedTapNetwork ?? undefined,
      });
      void this.monitorTrackedProcessExit(pid);
    } catch {
      await child.exited.catch(() => undefined);
      await removeTrackingArtifacts({
        ...tracking,
        managedTapNetwork: managedTapNetwork ?? undefined,
      });
    }
  }

  private async monitorTrackedProcessExit(pid: number): Promise<void> {
    try {
      await waitForProcessExit(pid);
    } finally {
      await this.untrackProcessId(pid, { removeArtifacts: true });
    }
  }

  private async stopTrackedProcesses(): Promise<void> {
    const runningProcesses = [...this.runningProcesses];
    const trackedEntries = [...this.trackedProcessMetadata.entries()];
    this.runningProcesses.clear();
    this.trackedProcessMetadata.clear();

    for (const child of runningProcesses) {
      try {
        child.kill();
      } catch {
        // Ignore already-exited children.
      }
    }

    for (const [pid] of trackedEntries) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ignore already-exited children.
      }
    }

    await Promise.allSettled(runningProcesses.map((child) => child.exited));
    await Promise.allSettled(
      trackedEntries.map(async ([, metadata]) =>
        removeTrackingArtifacts(metadata),
      ),
    );
  }

  private terminateTrackedProcessesSync(): void {
    const trackedEntries = [...this.trackedProcessMetadata.entries()];
    this.runningProcesses.clear();
    this.trackedProcessMetadata.clear();

    for (const [pid, metadata] of trackedEntries) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ignore already-exited processes during shutdown.
      }

      removeTrackingArtifactsSync(metadata);
    }
  }

  private async loadPresets(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.presetsPath), { recursive: true });
      const data = await fs.readFile(this.presetsPath, "utf-8");
      const parsed = JSON.parse(data);
      const normalizedPresets = Array.isArray(parsed)
        ? parsed
            .filter(
              (preset): preset is QemuVmPreset =>
                Boolean(preset) && typeof preset === "object",
            )
            .map((preset) => this.normalizePreset(preset))
        : [];
      this.presets = resolveTapInterfaceConflicts(normalizedPresets);

      if (JSON.stringify(parsed) !== JSON.stringify(this.presets)) {
        await this.persistPresets();
      }
    } catch {
      this.presets = [];
    }
  }

  private async persistPresets(): Promise<void> {
    await fs.mkdir(path.dirname(this.presetsPath), { recursive: true });
    await fs.writeFile(this.presetsPath, JSON.stringify(this.presets, null, 2));
  }

  private clonePreset(preset: QemuVmPreset): QemuVmPreset {
    return {
      ...preset,
      routerNetwork: preset.routerNetwork
        ? { ...preset.routerNetwork }
        : undefined,
      args: preset.args ? [...preset.args] : undefined,
    };
  }

  private normalizePreset(preset: QemuVmPreset): QemuVmPreset {
    const normalizedId = normalizeOptionalString(preset.id);
    if (!normalizedId) {
      throw new Error("QEMU preset id is required.");
    }

    const normalizedName = normalizeOptionalString(preset.name);
    if (!normalizedName) {
      throw new Error("QEMU preset name is required.");
    }

    const normalizedRole = normalizeVmRole(preset.role, "Qemu preset role");
    const normalizedRouterNetwork =
      normalizedRole === "router"
        ? migrateLegacyRouterNetworkConfig(
            normalizeRouterNetworkConfig(
              preset.routerNetwork,
              "Qemu preset routerNetwork",
              normalizedName,
            ),
          )
        : normalizeRouterNetworkConfig(
            preset.routerNetwork,
            "Qemu preset routerNetwork",
          );
    const normalizedArgs = preset.args
      ? [...preset.args].map((item) => item.trim()).filter(Boolean)
      : undefined;

    return {
      id: normalizedId,
      name: normalizedName,
      role: normalizedRole,
      routerNetwork: normalizedRouterNetwork,
      diskImage: normalizeOptionalString(preset.diskImage),
      diskFormat: normalizeOptionalString(preset.diskFormat),
      diskInterface: normalizeDiskInterface(
        preset.diskInterface,
        "Qemu preset diskInterface",
      ),
      cdrom:
        normalizedRole === "router"
          ? undefined
          : normalizeOptionalString(preset.cdrom),
      kernel: normalizeOptionalString(preset.kernel),
      initrd: normalizeOptionalString(preset.initrd),
      append: normalizeOptionalString(preset.append),
      memoryMb: normalizePositiveInteger(
        preset.memoryMb,
        "Qemu preset memoryMb",
      ),
      machine: normalizeOptionalString(preset.machine),
      accelerator: normalizeOptionalString(preset.accelerator),
      cpu: normalizeOptionalString(preset.cpu),
      smp: normalizePositiveInteger(preset.smp, "Qemu preset smp"),
      useProxy: preset.useProxy,
      headless: preset.headless,
      snapshot: preset.snapshot,
      daemonize: preset.daemonize,
      enableKvm: preset.enableKvm,
      args:
        normalizedRole === "router" && normalizedArgs
          ? normalizeManagedRouterArgs(normalizedArgs)
          : normalizedArgs,
    };
  }

  private async ensureRouterPresetArtifacts(
    preset: QemuVmPreset,
  ): Promise<void> {
    if (preset.role !== "router") {
      return;
    }

    const routerNetwork = normalizeRouterNetworkConfig(
      preset.routerNetwork,
      "Qemu preset routerNetwork",
      preset.name,
    );
    if (
      !routerNetwork?.hostname ||
      !routerNetwork.domain ||
      !routerNetwork.wanInterface ||
      !routerNetwork.lanInterface ||
      !routerNetwork.lanAddress ||
      !routerNetwork.lanPrefix ||
      !routerNetwork.dhcpStart ||
      !routerNetwork.dhcpEnd ||
      !routerNetwork.importDirectory
    ) {
      return;
    }

    await ensureRouterImportBundle(
      routerNetwork as Required<QemuRouterNetworkConfig>,
    );
  }

  private async maybeDetachRouterInstallerMedia(
    preset: QemuVmPreset,
    bootstrapState: QemuRouterBootstrapState,
  ): Promise<QemuVmPreset> {
    if (preset.role !== "router" || !preset.cdrom) {
      return preset;
    }

    if (
      bootstrapState.status !== "needs-bootstrap" &&
      bootstrapState.status !== "bootstrapped"
    ) {
      return preset;
    }

    const updatedPreset = this.normalizePreset({
      ...preset,
      cdrom: undefined,
    });
    const index = this.presets.findIndex(
      (existingPreset) => existingPreset.id === preset.id,
    );
    if (index >= 0) {
      this.presets[index] = updatedPreset;
      await this.persistPresets();
    }

    return updatedPreset;
  }

  private async maybeBootstrapRouterPreset(
    preset: QemuVmPreset,
    bootstrapState?: QemuRouterBootstrapState,
    options: {
      onProgress?: (progress: QemuRouterBootstrapProgress) => void;
      username?: string;
      password?: string;
      rebootAfterRestore?: boolean;
    } = {},
  ): Promise<void> {
    if (preset.role !== "router") {
      return;
    }

    const routerNetwork = normalizeRouterNetworkConfig(
      preset.routerNetwork,
      "Qemu preset routerNetwork",
      preset.name,
    );
    if (
      !routerNetwork?.hostname ||
      !routerNetwork.domain ||
      !routerNetwork.wanInterface ||
      !routerNetwork.lanInterface ||
      !routerNetwork.lanAddress ||
      !routerNetwork.lanPrefix ||
      !routerNetwork.dhcpStart ||
      !routerNetwork.dhcpEnd ||
      !routerNetwork.importDirectory ||
      !preset.diskImage
    ) {
      return;
    }

    const resolvedBootstrapState =
      bootstrapState ?? (await inspectRouterBootstrapState(preset.diskImage));
    if (resolvedBootstrapState.status === "bootstrapped") {
      return;
    }

    if (resolvedBootstrapState.status === "uninstalled") {
      return;
    }

    if (resolvedBootstrapState.status === "in-use") {
      return;
    }

    if (resolvedBootstrapState.status === "unknown") {
      console.warn(
        `Skipping automatic router bootstrap for ${preset.name}: ${resolvedBootstrapState.reason}`,
      );
      return;
    }

    const emit = (
      stage: QemuRouterBootstrapProgress["stage"],
      message: string,
    ): void => {
      options.onProgress?.({
        stage,
        message,
        createdAt: Date.now(),
      });
    };

    const bootstrapUsername =
      normalizeOptionalString(options.username) ??
      this.config.bootstrapUsername;
    const bootstrapPassword =
      normalizeOptionalString(options.password) ??
      this.config.bootstrapPassword;
    const rebootAfterRestore = options.rebootAfterRestore ?? false;

    let helper: QemuRouterBootstrapHelper | undefined;
    try {
      emit("start-helper", "Starting temporary QEMU bootstrap helper.");
      helper = await startRouterBootstrapHelper(
        $manifest.resolveDependencyCommand(
          this.config.systemDependencyId,
          "QEMU system binary is required for QemuKit",
        ),
        this.createLaunchSpecFromPreset(preset),
        routerNetwork as Required<QemuRouterNetworkConfig>,
      );
      emit("wait-ui", `Waiting for OPNsense bootstrap UI at ${helper.baseUrl}`);
      const loginPage = await waitForRouterBootstrapUi(helper.baseUrl);
      const cookieJar = new Map<string, string>();
      emit(
        "login",
        `Logging into the OPNsense bootstrap web UI as ${bootstrapUsername}.`,
      );
      await loginToRouterBootstrapUi(
        helper.baseUrl,
        cookieJar,
        bootstrapUsername,
        bootstrapPassword,
        loginPage,
      );
      const configPath = path.join(
        routerNetwork.importDirectory,
        "conf",
        "config.xml",
      );
      emit("restore-config", `Uploading generated config from ${configPath}`);
      await restoreRouterConfigThroughWebUi(
        helper.baseUrl,
        cookieJar,
        configPath,
        rebootAfterRestore,
      );
      if (rebootAfterRestore) {
        emit(
          "wait-reboot",
          "Waiting for the router reboot to begin after config restore.",
        );
        await waitForRouterBootstrapReboot(helper.baseUrl);
      } else {
        emit(
          "complete",
          "Router config restore finished without requesting an immediate reboot.",
        );
      }
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("bootstrap login") ||
        message.includes("login form")
      ) {
        message +=
          " Pass username/password to kits/qemu/bootstrap or set manifest.kits.qemu.bootstrapUsername and manifest.kits.qemu.bootstrapPassword.";
      }
      throw new Error(`Router bootstrap failed for ${preset.name}: ${message}`);
    } finally {
      await stopRouterBootstrapHelper(helper);
    }
  }

  private resolvePresetOrNull(target: string): QemuVmPreset | null {
    const normalizedTarget = target.trim();
    if (normalizedTarget.length === 0) {
      return null;
    }

    const byId = this.presets.find((preset) => preset.id === normalizedTarget);
    if (byId) {
      return byId;
    }

    const byName = this.presets.filter(
      (preset) => preset.name === normalizedTarget,
    );
    if (byName.length === 1) {
      return byName[0] ?? null;
    }

    if (byName.length > 1) {
      throw new Error(`QEMU preset target is ambiguous: ${normalizedTarget}`);
    }

    return null;
  }

  private resolvePreset(target: string): QemuVmPreset {
    const preset = this.resolvePresetOrNull(target);
    if (preset) {
      return preset;
    }

    throw new Error(
      `QEMU preset ${target} not found. Use a preset id or a unique preset name.`,
    );
  }
}
