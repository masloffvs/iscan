import {
  buildCloakUserAgentOptions,
  CLOAK_SEARCH_ENGINE_PRESETS,
  findCloakViewportPreset,
  listCloakViewportPresets,
  type CloakUserAgentOption,
  type CloakViewportPreset,
} from "../../kits/cloak-profile-editor";
import { type CloakKit, type CloakProfile } from "../../kits/cloak-kit";
import { MICROLINK_UA_KIT_ID, MicrolinkUaKit } from "../../kits/microlink-ua-kit";
import { type ProxyProfile } from "../../kits/proxy-kit";
import { formatProxyProfileUrl } from "../../modules/kits/proxy-shared";
import { VmServerHttpError } from "./http";
import { normalizeRequiredTrimmedString } from "./parsers";
import type { VmBrowserProfileEditorData, VmBrowserUserAgentSelection, VmBrowserViewportSelection } from "./types";

export function resolveVmBrowserProfile(profiles: readonly CloakProfile[], target: string): CloakProfile {
  const normalizedTarget = normalizeRequiredTrimmedString(target, "Browser profile target");
  const byId = profiles.find((profile) => profile.id === normalizedTarget);
  if (byId) {
    return byId;
  }

  const byName = profiles.filter((profile) => profile.name === normalizedTarget);
  if (byName.length === 1) {
    return byName[0]!;
  }

  if (byName.length > 1) {
    throw new VmServerHttpError(409, `Browser profile target '${normalizedTarget}' is ambiguous. Use a profile id.`);
  }

  throw new VmServerHttpError(404, `Browser profile '${normalizedTarget}' was not found.`);
}

export function createVmBrowserProxyOption(proxy: ProxyProfile) {
  return {
    authConfigured: Boolean(proxy.username),
    endpoint: `${proxy.host}:${proxy.port}`,
    id: proxy.id,
    name: proxy.name,
    type: proxy.type,
  };
}

export function createVmBrowserProxySelection(profile: CloakProfile, proxies: readonly ProxyProfile[]) {
  const configuredProxy = typeof profile.proxy === "string" && profile.proxy.trim().length > 0
    ? profile.proxy.trim()
    : null;
  if (!configuredProxy) {
    return {
      label: "No proxy",
      mode: "none" as const,
      proxyId: null,
    };
  }

  const matchingProxy = proxies.find((proxy) => formatProxyProfileUrl(proxy) === configuredProxy);
  if (matchingProxy) {
    return {
      label: `${matchingProxy.name} (${matchingProxy.type} ${matchingProxy.host}:${matchingProxy.port})`,
      mode: "saved" as const,
      proxyId: matchingProxy.id,
    };
  }

  return {
    label: "Existing custom proxy URI stored in profile",
    mode: "preserve" as const,
    proxyId: null,
  };
}

export function createVmEditableBrowserProfile(
  kit: CloakKit,
  profile: CloakProfile,
  proxies: readonly ProxyProfile[],
) {
  return {
    currentUrl: kit.getProfileCurrentUrl(profile.id) ?? null,
    headless: profile.headless ?? false,
    humanize: profile.humanize ?? false,
    id: profile.id,
    isRunning: kit.isProfileRunning(profile.id),
    locale: profile.locale ?? null,
    name: profile.name,
    proxySelection: createVmBrowserProxySelection(profile, proxies),
    searchEngine: profile.searchEngine ?? null,
    timezone: profile.timezone ?? null,
    userAgent: profile.userAgent ?? null,
    userDataDir: profile.userDataDir ?? null,
    viewportHeight: typeof profile.viewportHeight === "number" ? profile.viewportHeight : null,
    viewportWidth: typeof profile.viewportWidth === "number" ? profile.viewportWidth : null,
  };
}

export function createVmBrowserViewportSelection(
  profile: CloakProfile,
  viewportPresets: readonly CloakViewportPreset[],
): VmBrowserViewportSelection {
  const width = typeof profile.viewportWidth === "number" ? profile.viewportWidth : null;
  const height = typeof profile.viewportHeight === "number" ? profile.viewportHeight : null;
  if (width === null || height === null) {
    return {
      label: "Browser default",
      mode: "empty",
      presetId: null,
    };
  }

  const preset = findCloakViewportPreset(width, height, viewportPresets);
  if (preset) {
    return {
      label: `${preset.label} (${preset.id})`,
      mode: "preset",
      presetId: preset.id,
    };
  }

  return {
    label: `Existing custom viewport ${width}x${height}`,
    mode: "custom-existing",
    presetId: null,
  };
}

export function createVmBrowserUserAgentSelection(
  profile: CloakProfile,
  userAgentOptions: readonly CloakUserAgentOption[],
): VmBrowserUserAgentSelection {
  const userAgent = typeof profile.userAgent === "string" && profile.userAgent.trim().length > 0
    ? profile.userAgent.trim()
    : null;
  if (!userAgent) {
    return {
      label: "Browser default",
      mode: "empty",
      userAgent: null,
    };
  }

  const matchingOption = userAgentOptions.find((option) => option.userAgent === userAgent);
  if (matchingOption) {
    return {
      label: matchingOption.label,
      mode: "preset",
      userAgent: matchingOption.userAgent,
    };
  }

  return {
    label: "Existing custom user agent stored in profile",
    mode: "custom-existing",
    userAgent,
  };
}

async function createVmBrowserProfileEditorData(
  userAgents: readonly string[],
  profile: CloakProfile,
): Promise<VmBrowserProfileEditorData> {
  const viewportPresets = await listCloakViewportPresets();
  const userAgentOptions = buildCloakUserAgentOptions(userAgents);

  return {
    searchEnginePresets: CLOAK_SEARCH_ENGINE_PRESETS.map((entry) => ({ ...entry })),
    userAgentOptions,
    userAgentSelection: createVmBrowserUserAgentSelection(profile, userAgentOptions),
    viewportPresets: viewportPresets.map((entry) => ({ ...entry })),
    viewportSelection: createVmBrowserViewportSelection(profile, viewportPresets),
  };
}

export async function createVmBrowserProfilePayload(
  kit: CloakKit,
  userAgentKit: MicrolinkUaKit,
  profile: CloakProfile,
  proxies: readonly ProxyProfile[],
) {
  const userAgents = await userAgentKit.listUserAgents();
  return {
    editorData: await createVmBrowserProfileEditorData(userAgents, profile),
    profile: createVmEditableBrowserProfile(kit, profile, proxies),
    proxyOptions: proxies.map((entry) => createVmBrowserProxyOption(entry)),
    target: profile.id,
  };
}

export async function createVmMicrolinkUaPayload(userAgentKit: MicrolinkUaKit) {
  return {
    status: await userAgentKit.getStatus(),
    userAgents: await userAgentKit.listUserAgents(),
  };
}
