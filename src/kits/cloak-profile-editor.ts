export type CloakViewportOrientation = "portrait" | "landscape";

export type CloakViewportPreset = {
  category: string;
  description: string;
  deviceId: string;
  deviceName: string;
  height: number;
  id: string;
  label: string;
  orientation: CloakViewportOrientation;
  width: number;
};

type CloakViewportSourceEntry = {
  landscapeWidth: number;
  name: string;
  portraitWidth: number;
};

type CloakViewportSourceCatalog = Record<string, CloakViewportSourceEntry>;

const CLOAK_VIEWPORT_SOURCE_URL = "https://raw.githubusercontent.com/DevExpress/device-specs/refs/heads/master/viewport-sizes.json";
const CLOAK_VIEWPORT_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

export type CloakSearchEnginePreset = {
  id: string;
  label: string;
  value: string;
};

export type CloakUserAgentDeviceClass = "desktop" | "mobile" | "tablet";

export type CloakUserAgentOption = {
  browserFamily: string;
  browserVersion: string | null;
  deviceClass: CloakUserAgentDeviceClass;
  label: string;
  osFamily: string;
  userAgent: string;
};

export const CLOAK_VIEWPORT_PRESETS: readonly CloakViewportPreset[] = [
  {
    id: "1280x720",
    label: "HD 720p",
    width: 1280,
    height: 720,
    category: "HD",
    description: "Compact desktop and small laptop window",
    deviceId: "desktop-hd-720p",
    deviceName: "HD 720p",
    orientation: "landscape",
  },
  {
    id: "1366x768",
    label: "Laptop 1366",
    width: 1366,
    height: 768,
    category: "HD",
    description: "Common 15-inch laptop window size",
    deviceId: "desktop-laptop-1366",
    deviceName: "Laptop 1366",
    orientation: "landscape",
  },
  {
    id: "1440x900",
    label: "WXGA+",
    width: 1440,
    height: 900,
    category: "Laptop",
    description: "Widescreen laptop and compact desktop",
    deviceId: "desktop-wxga-plus",
    deviceName: "WXGA+",
    orientation: "landscape",
  },
  {
    id: "1536x864",
    label: "FHD Compact",
    width: 1536,
    height: 864,
    category: "FHD",
    description: "A common smaller browser window on 1080p displays",
    deviceId: "desktop-fhd-compact",
    deviceName: "FHD Compact",
    orientation: "landscape",
  },
  {
    id: "1600x900",
    label: "HD+",
    width: 1600,
    height: 900,
    category: "Laptop",
    description: "Common widescreen notebook and desktop size",
    deviceId: "desktop-hd-plus",
    deviceName: "HD+",
    orientation: "landscape",
  },
  {
    id: "1680x1050",
    label: "WSXGA+",
    width: 1680,
    height: 1050,
    category: "Desktop",
    description: "Classic widescreen desktop resolution",
    deviceId: "desktop-wsxga-plus",
    deviceName: "WSXGA+",
    orientation: "landscape",
  },
  {
    id: "1920x1080",
    label: "Full HD",
    width: 1920,
    height: 1080,
    category: "FHD",
    description: "Full-size desktop browser window",
    deviceId: "desktop-full-hd",
    deviceName: "Full HD",
    orientation: "landscape",
  },
  {
    id: "1920x1200",
    label: "WUXGA",
    width: 1920,
    height: 1200,
    category: "Desktop",
    description: "16:10 workstation and productivity displays",
    deviceId: "desktop-wuxga",
    deviceName: "WUXGA",
    orientation: "landscape",
  },
  {
    id: "2048x1152",
    label: "2K Lite",
    width: 2048,
    height: 1152,
    category: "QHD",
    description: "Large browser window for dense layouts",
    deviceId: "desktop-2k-lite",
    deviceName: "2K Lite",
    orientation: "landscape",
  },
  {
    id: "2560x1440",
    label: "QHD",
    width: 2560,
    height: 1440,
    category: "QHD",
    description: "High-density desktop display",
    deviceId: "desktop-qhd",
    deviceName: "QHD",
    orientation: "landscape",
  },
  {
    id: "2560x1600",
    label: "WQXGA",
    width: 2560,
    height: 1600,
    category: "HiDPI",
    description: "16:10 high-density laptop or workstation",
    deviceId: "desktop-wqxga",
    deviceName: "WQXGA",
    orientation: "landscape",
  },
  {
    id: "3440x1440",
    label: "Ultrawide",
    width: 3440,
    height: 1440,
    category: "Ultrawide",
    description: "Ultrawide desktop window",
    deviceId: "desktop-ultrawide",
    deviceName: "Ultrawide",
    orientation: "landscape",
  },
  {
    id: "3840x2160",
    label: "4K UHD",
    width: 3840,
    height: 2160,
    category: "HiDPI",
    description: "Large high-density desktop display",
    deviceId: "desktop-4k-uhd",
    deviceName: "4K UHD",
    orientation: "landscape",
  },
] as const;

type CloakViewportCache = {
  expiresAt: number;
  presets: readonly CloakViewportPreset[];
};

let cloakViewportCache: CloakViewportCache | null = null;
let cloakViewportCachePromise: Promise<readonly CloakViewportPreset[]> | null = null;

export const CLOAK_SEARCH_ENGINE_PRESETS: readonly CloakSearchEnginePreset[] = [
  { id: "google", label: "Google", value: "Google" },
  { id: "duckduckgo", label: "DuckDuckGo", value: "DuckDuckGo" },
  { id: "bing", label: "Bing", value: "Bing" },
  { id: "yahoo", label: "Yahoo", value: "Yahoo" },
  { id: "yandex", label: "Yandex", value: "Yandex" },
  { id: "brave", label: "Brave", value: "Brave" },
] as const;

export const CLOAK_VIEWPORT_PRESET_VALUES: readonly string[] = ["", ...CLOAK_VIEWPORT_PRESETS.map((preset) => preset.id)];
export const CLOAK_SEARCH_ENGINE_PRESET_VALUES: readonly string[] = ["", ...CLOAK_SEARCH_ENGINE_PRESETS.map((preset) => preset.value)];

function inferViewportCategory(deviceName: string): string {
  const normalized = deviceName.trim();
  if (normalized.length === 0) {
    return "Other";
  }

  if (/^iPhone/iu.test(normalized)) {
    return "iPhone";
  }

  if (/^iPad/iu.test(normalized)) {
    return "iPad";
  }

  if (/Pixel|Nexus/iu.test(normalized)) {
    return "Google";
  }

  if (/Galaxy|Samsung/iu.test(normalized)) {
    return "Samsung";
  }

  if (/Surface/iu.test(normalized)) {
    return "Microsoft";
  }

  return normalized.split(/\s+/u)[0] ?? "Other";
}

function cloneViewportPresets(presets: readonly CloakViewportPreset[]): CloakViewportPreset[] {
  return presets.map((preset) => ({ ...preset }));
}

function isViewportSourceEntry(value: unknown): value is CloakViewportSourceEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Partial<CloakViewportSourceEntry>;
  return typeof entry.name === "string"
    && typeof entry.portraitWidth === "number"
    && Number.isFinite(entry.portraitWidth)
    && typeof entry.landscapeWidth === "number"
    && Number.isFinite(entry.landscapeWidth);
}

function isViewportSourceCatalog(value: unknown): value is CloakViewportSourceCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => isViewportSourceEntry(entry));
}

function createViewportPresetFromSource(
  deviceId: string,
  deviceName: string,
  orientation: CloakViewportOrientation,
  width: number,
  height: number,
): CloakViewportPreset {
  const orientationLabel = orientation === "portrait" ? "Portrait" : "Landscape";
  return {
    category: inferViewportCategory(deviceName),
    description: `${width}x${height} ${orientationLabel.toLowerCase()} viewport`,
    deviceId,
    deviceName,
    height,
    id: `${deviceId}:${orientation}`,
    label: `${deviceName} · ${orientationLabel}`,
    orientation,
    width,
  };
}

export function buildCloakViewportPresets(source: CloakViewportSourceCatalog): CloakViewportPreset[] {
  const presets: CloakViewportPreset[] = [];

  for (const [deviceId, entry] of Object.entries(source)) {
    const deviceName = entry.name.trim();
    if (deviceName.length === 0) {
      continue;
    }

    const portraitWidth = Math.round(entry.portraitWidth);
    const landscapeWidth = Math.round(entry.landscapeWidth);
    if (portraitWidth <= 0 || landscapeWidth <= 0) {
      continue;
    }

    presets.push(
      createViewportPresetFromSource(deviceId, deviceName, "portrait", portraitWidth, landscapeWidth),
      createViewportPresetFromSource(deviceId, deviceName, "landscape", landscapeWidth, portraitWidth),
    );
  }

  return presets.sort((left, right) => {
    if (left.category !== right.category) {
      return left.category.localeCompare(right.category);
    }

    if (left.deviceName !== right.deviceName) {
      return left.deviceName.localeCompare(right.deviceName);
    }

    if (left.orientation !== right.orientation) {
      return left.orientation.localeCompare(right.orientation);
    }

    if (left.width !== right.width) {
      return left.width - right.width;
    }

    return left.height - right.height;
  });
}

export async function listCloakViewportPresets(): Promise<CloakViewportPreset[]> {
  const now = Date.now();
  if (cloakViewportCache && cloakViewportCache.expiresAt > now) {
    return cloneViewportPresets(cloakViewportCache.presets);
  }

  if (!cloakViewportCachePromise) {
    cloakViewportCachePromise = (async () => {
      try {
        const response = await fetch(CLOAK_VIEWPORT_SOURCE_URL);
        if (!response.ok) {
          throw new Error(`Viewport source request failed with ${response.status}`);
        }

        const payload = await response.json();
        if (!isViewportSourceCatalog(payload)) {
          throw new Error("Viewport source payload has an unexpected shape.");
        }

        const presets = buildCloakViewportPresets(payload);
        if (presets.length === 0) {
          throw new Error("Viewport source payload did not produce any presets.");
        }

        cloakViewportCache = {
          expiresAt: Date.now() + CLOAK_VIEWPORT_CACHE_TTL_MS,
          presets,
        };
        return presets;
      } catch {
        const fallbackPresets = cloneViewportPresets(CLOAK_VIEWPORT_PRESETS);
        cloakViewportCache = {
          expiresAt: Date.now() + CLOAK_VIEWPORT_CACHE_TTL_MS,
          presets: fallbackPresets,
        };
        return fallbackPresets;
      } finally {
        cloakViewportCachePromise = null;
      }
    })();
  }

  return cloneViewportPresets(await cloakViewportCachePromise);
}

function inferUserAgentBrowserFamily(userAgent: string): { family: string; version: string | null } {
  const candidates: Array<{ family: string; pattern: RegExp }> = [
    { family: "Edge", pattern: /Edg\/([\d.]+)/u },
    { family: "Opera", pattern: /OPR\/([\d.]+)/u },
    { family: "Firefox", pattern: /Firefox\/([\d.]+)/u },
    { family: "Chrome", pattern: /Chrome\/([\d.]+)/u },
    { family: "Safari", pattern: /Version\/([\d.]+).*Safari\//u },
  ];

  for (const candidate of candidates) {
    const match = userAgent.match(candidate.pattern);
    if (match?.[1]) {
      return {
        family: candidate.family,
        version: match[1].split(".")[0] ?? null,
      };
    }
  }

  return {
    family: "Other",
    version: null,
  };
}

function inferUserAgentOsFamily(userAgent: string): string {
  if (/iPad|iPadOS/iu.test(userAgent)) {
    return "iPadOS";
  }

  if (/iPhone|iOS/iu.test(userAgent)) {
    return "iOS";
  }

  if (/Android/iu.test(userAgent)) {
    return "Android";
  }

  if (/Windows NT/iu.test(userAgent)) {
    return "Windows";
  }

  if (/Mac OS X|Macintosh/iu.test(userAgent)) {
    return "macOS";
  }

  if (/Linux|X11/iu.test(userAgent)) {
    return "Linux";
  }

  return "Other";
}

function inferUserAgentDeviceClass(userAgent: string): CloakUserAgentDeviceClass {
  if (/iPad|Tablet/iu.test(userAgent)) {
    return "tablet";
  }

  if (/Mobile|Android|iPhone/iu.test(userAgent)) {
    return "mobile";
  }

  return "desktop";
}

function createUserAgentLabel(userAgent: string): string {
  const browser = inferUserAgentBrowserFamily(userAgent);
  const osFamily = inferUserAgentOsFamily(userAgent);
  const deviceClass = inferUserAgentDeviceClass(userAgent);
  const versionSuffix = browser.version ? ` ${browser.version}` : "";
  const deviceLabel = deviceClass === "desktop"
    ? "Desktop"
    : deviceClass === "tablet"
      ? "Tablet"
      : "Mobile";
  return `${browser.family}${versionSuffix} · ${osFamily} · ${deviceLabel}`;
}

export function buildCloakUserAgentOptions(userAgents: readonly string[]): CloakUserAgentOption[] {
  const seen = new Set<string>();
  const options: CloakUserAgentOption[] = [];

  for (const value of userAgents) {
    const userAgent = typeof value === "string" ? value.trim() : "";
    if (userAgent.length === 0 || seen.has(userAgent)) {
      continue;
    }

    seen.add(userAgent);
    const browser = inferUserAgentBrowserFamily(userAgent);
    options.push({
      browserFamily: browser.family,
      browserVersion: browser.version,
      deviceClass: inferUserAgentDeviceClass(userAgent),
      label: createUserAgentLabel(userAgent),
      osFamily: inferUserAgentOsFamily(userAgent),
      userAgent,
    });
  }

  return options.sort((left, right) => {
    if (left.deviceClass !== right.deviceClass) {
      return left.deviceClass.localeCompare(right.deviceClass);
    }

    if (left.browserFamily !== right.browserFamily) {
      return left.browserFamily.localeCompare(right.browserFamily);
    }

    if (left.osFamily !== right.osFamily) {
      return left.osFamily.localeCompare(right.osFamily);
    }

    return left.label.localeCompare(right.label);
  });
}

export function findCloakViewportPreset(
  width: number | null | undefined,
  height: number | null | undefined,
  presets: readonly CloakViewportPreset[] = CLOAK_VIEWPORT_PRESETS,
): CloakViewportPreset | null {
  if (typeof width !== "number" || typeof height !== "number") {
    return null;
  }

  return presets.find((preset) => preset.width === width && preset.height === height) ?? null;
}
