import {
  useEffect,
  useMemo,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import {
  getRemoteBrowserProfileSettings,
  saveRemoteBrowserProfileSettings,
  type RemoteBrowserProfileEditorData,
  type RemoteBrowserProfileSettings,
  type RemoteBrowserProxyOption,
  type RemoteBrowserProxySelectionMode,
  type RemoteBrowserSearchEnginePreset,
  type RemoteBrowserUserAgentOption,
  type RemoteBrowserViewportPreset,
} from "../api/client";
import { useInterfaceStore } from "../store/ui";

type BrowserProfileDraft = {
  headless: boolean;
  humanize: boolean;
  locale: string;
  name: string;
  proxyMode: RemoteBrowserProxySelectionMode;
  proxyId: string;
  searchEngine: string;
  timezone: string;
  userAgent: string;
  userDataDir: string;
  viewportHeight: string;
  viewportWidth: string;
};

type BrowserProfileTab = "general" | "proxy" | "viewport" | "user-agent";
type UserAgentDeviceFilter = RemoteBrowserUserAgentOption["deviceClass"] | "all";

const PRESERVE_PROXY_VALUE = "__preserve__";
const NO_PROXY_VALUE = "__none__";
const BROWSER_DEFAULT_VIEWPORT_VALUE = "__browser_default__";
const CUSTOM_VIEWPORT_VALUE = "__custom_viewport__";
const DEFAULT_USER_AGENT_DEVICE_FILTER: UserAgentDeviceFilter = "desktop";
const DEFAULT_USER_AGENT_VERSION_FILTER = "all";
const BROWSER_PROFILE_TABS: ReadonlyArray<{ id: BrowserProfileTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "proxy", label: "Proxy" },
  { id: "viewport", label: "Viewport" },
  { id: "user-agent", label: "User Agent" },
];

function createDraft(profile: RemoteBrowserProfileSettings): BrowserProfileDraft {
  return {
    headless: profile.headless,
    humanize: profile.humanize,
    locale: profile.locale ?? "",
    name: profile.name,
    proxyId: profile.proxySelection.proxyId ?? "",
    proxyMode: profile.proxySelection.mode,
    searchEngine: profile.searchEngine ?? "",
    timezone: profile.timezone ?? "",
    userAgent: profile.userAgent ?? "",
    userDataDir: profile.userDataDir ?? "",
    viewportHeight: profile.viewportHeight === null ? "" : String(profile.viewportHeight),
    viewportWidth: profile.viewportWidth === null ? "" : String(profile.viewportWidth),
  };
}

function validateDimension(value: string, label: string): string | null {
  if (value.trim().length === 0) {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 10000) {
    return `${label} must be an integer between 1 and 10000.`;
  }

  return null;
}

function validateDraft(draft: BrowserProfileDraft): string | null {
  if (draft.name.trim().length === 0) {
    return "Profile name is required.";
  }

  if (draft.proxyMode === "saved" && draft.proxyId.trim().length === 0) {
    return "Select a saved proxy or switch the profile back to no proxy.";
  }

  return validateDimension(draft.viewportWidth, "Viewport width")
    ?? validateDimension(draft.viewportHeight, "Viewport height");
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalDimension(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return Number.parseInt(trimmed, 10);
}

function parseDraftDimension(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const numericValue = Number.parseInt(trimmed, 10);
  return Number.isInteger(numericValue) ? numericValue : null;
}

function getProxySelectValue(draft: BrowserProfileDraft): string {
  if (draft.proxyMode === "saved") {
    return draft.proxyId;
  }

  return draft.proxyMode === "preserve" ? PRESERVE_PROXY_VALUE : NO_PROXY_VALUE;
}

function updateProxyDraft(draft: BrowserProfileDraft, value: string): BrowserProfileDraft {
  if (value === NO_PROXY_VALUE) {
    return {
      ...draft,
      proxyId: "",
      proxyMode: "none",
    };
  }

  if (value === PRESERVE_PROXY_VALUE) {
    return {
      ...draft,
      proxyId: "",
      proxyMode: "preserve",
    };
  }

  return {
    ...draft,
    proxyId: value,
    proxyMode: "saved",
  };
}

function getViewportSelectValue(
  draft: BrowserProfileDraft,
  editorData: RemoteBrowserProfileEditorData | null,
): string {
  const preset = findViewportPresetForDraft(draft, editorData);
  if (preset) {
    return preset.id;
  }

  if (draft.viewportWidth.trim().length === 0 && draft.viewportHeight.trim().length === 0) {
    return BROWSER_DEFAULT_VIEWPORT_VALUE;
  }

  return CUSTOM_VIEWPORT_VALUE;
}

function updateViewportDraft(
  draft: BrowserProfileDraft,
  editorData: RemoteBrowserProfileEditorData,
  value: string,
): BrowserProfileDraft {
  if (value === BROWSER_DEFAULT_VIEWPORT_VALUE) {
    return {
      ...draft,
      viewportHeight: "",
      viewportWidth: "",
    };
  }

  if (value === CUSTOM_VIEWPORT_VALUE) {
    return draft;
  }

  const preset = editorData.viewportPresets.find((entry) => entry.id === value);
  if (!preset) {
    return draft;
  }

  return {
    ...draft,
    viewportHeight: String(preset.height),
    viewportWidth: String(preset.width),
  };
}

function findViewportPresetForDraft(
  draft: BrowserProfileDraft,
  editorData: RemoteBrowserProfileEditorData | null,
): RemoteBrowserViewportPreset | null {
  if (!editorData) {
    return null;
  }

  const width = parseDraftDimension(draft.viewportWidth);
  const height = parseDraftDimension(draft.viewportHeight);
  if (width === null || height === null) {
    return null;
  }

  return editorData.viewportPresets.find((preset) => preset.width === width && preset.height === height) ?? null;
}

function findUserAgentOptionForDraft(
  draft: BrowserProfileDraft,
  editorData: RemoteBrowserProfileEditorData | null,
): RemoteBrowserUserAgentOption | null {
  const userAgent = draft.userAgent.trim();
  if (!editorData || userAgent.length === 0) {
    return null;
  }

  return editorData.userAgentOptions.find((option) => option.userAgent === userAgent) ?? null;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function formatDeviceClassLabel(value: RemoteBrowserUserAgentOption["deviceClass"]): string {
  switch (value) {
    case "desktop":
      return "Desktop";
    case "tablet":
      return "Tablet";
    case "mobile":
      return "Mobile";
    default:
      return value;
  }
}

function formatBrowserVersionLabel(value: string | null): string {
  return value && value.trim().length > 0 ? value : "Unknown version";
}

function createUserAgentGroupLabel(option: RemoteBrowserUserAgentOption): string {
  return `${option.browserFamily} · ${option.osFamily} · ${formatDeviceClassLabel(option.deviceClass)}`;
}

function sanitizeFilenameSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function describeProxySelection(
  draft: BrowserProfileDraft,
  profile: RemoteBrowserProfileSettings | null,
  proxyOptions: readonly RemoteBrowserProxyOption[],
): { detail: string; label: string } {
  if (draft.proxyMode === "none") {
    return {
      label: "No proxy",
      detail: "The browser launches directly without a saved proxy profile.",
    };
  }

  if (draft.proxyMode === "preserve") {
    return {
      label: profile?.proxySelection.label ?? "Keep current custom proxy",
      detail: "The existing custom proxy URI stays untouched until you explicitly replace it.",
    };
  }

  const matchingOption = proxyOptions.find((option) => option.id === draft.proxyId) ?? null;
  if (!matchingOption) {
    return {
      label: "Saved proxy selected",
      detail: "The selected proxy will be resolved when you save the profile.",
    };
  }

  return {
    label: `${matchingOption.name} (${matchingOption.type} ${matchingOption.endpoint})`,
    detail: matchingOption.authConfigured ? "Authentication is configured for this proxy." : "No proxy authentication is configured.",
  };
}

function getViewportSelectionSummary(
  draft: BrowserProfileDraft,
  editorData: RemoteBrowserProfileEditorData | null,
): { detail: string; label: string } {
  const preset = findViewportPresetForDraft(draft, editorData);
  if (preset) {
    return {
      label: `${preset.label} (${preset.id})`,
      detail: preset.description,
    };
  }

  const width = draft.viewportWidth.trim();
  const height = draft.viewportHeight.trim();
  if (width.length === 0 || height.length === 0) {
    return {
      label: "Browser default",
      detail: "The browser keeps its default window size and fingerprint metrics.",
    };
  }

  return {
    label: `${width}x${height}`,
    detail: "Existing custom viewport is preserved until you choose a preset or edit the dimensions manually.",
  };
}

function formatViewportOptionLabel(preset: RemoteBrowserViewportPreset): string {
  return `${preset.label} (${preset.width}x${preset.height})`;
}

function getUserAgentSelectionSummary(
  draft: BrowserProfileDraft,
  editorData: RemoteBrowserProfileEditorData | null,
): { detail: string; label: string } {
  const option = findUserAgentOptionForDraft(draft, editorData);
  if (option) {
    return {
      label: option.label,
      detail: option.userAgent,
    };
  }

  if (draft.userAgent.trim().length === 0) {
    return {
      label: "Browser default",
      detail: "No explicit user agent override is stored for this profile.",
    };
  }

  return {
    label: "Custom user agent",
    detail: draft.userAgent.trim(),
  };
}

function createInitialUserAgentFilters(
  profile: RemoteBrowserProfileSettings,
  editorData: RemoteBrowserProfileEditorData,
): {
  browserFamily: string;
  browserVersion: string;
  deviceClass: UserAgentDeviceFilter;
  osFamily: string;
} {
  const matchingOption = editorData.userAgentOptions.find((option) => option.userAgent === profile.userAgent) ?? null;
  if (matchingOption) {
    return {
      browserFamily: matchingOption.browserFamily,
      browserVersion: matchingOption.browserVersion ?? DEFAULT_USER_AGENT_VERSION_FILTER,
      deviceClass: matchingOption.deviceClass,
      osFamily: matchingOption.osFamily,
    };
  }

  return {
    browserFamily: "all",
    browserVersion: DEFAULT_USER_AGENT_VERSION_FILTER,
    deviceClass: DEFAULT_USER_AGENT_DEVICE_FILTER,
    osFamily: "all",
  };
}

function Panel({
  children,
  className = "",
  description,
  title,
}: {
  children: ReactNode;
  className?: string;
  description?: string;
  title?: string;
}) {
  return (
    <section className={`rounded-[16px] bg-white/[0.03] p-3 ${className}`.trim()}>
      {title ? (
        <div className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white">{title}</p>
          {description ? <p className="mt-1 text-[11px] leading-relaxed text-[#878790]">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#8f8f98]">{label}</span>
      {hint ? <span className="mt-1 block text-[10px] text-[#666670]">{hint}</span> : null}
    </label>
  );
}

function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`mt-2 w-full rounded-[12px] bg-black/20 px-3 py-2 text-[12px] text-white outline-none transition placeholder:text-[#5f5f69] focus:bg-black/30 ${props.className ?? ""}`.trim()}
    />
  );
}

function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`mt-2 w-full rounded-[12px] bg-black/20 px-3 py-2 text-[12px] text-white outline-none transition focus:bg-black/30 ${props.className ?? ""}`.trim()}
    />
  );
}

function TextareaInput(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`mt-2 w-full rounded-[12px] bg-black/20 px-3 py-2 text-[12px] text-white outline-none transition placeholder:text-[#5f5f69] focus:bg-black/30 ${props.className ?? ""}`.trim()}
    />
  );
}

function CheckboxRow({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-[12px] bg-black/20 px-3 py-2.5 transition hover:bg-black/25">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded bg-black/30 text-white"
      />
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-white">{label}</span>
        <span className="mt-1 block text-[11px] leading-relaxed text-[#868692]">{description}</span>
      </span>
    </label>
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
      className={`rounded-[10px] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] transition ${active ? "bg-white/[0.09] text-white" : "text-[#8f8f98] hover:bg-white/[0.04] hover:text-white"}`}
    >
      {label}
    </button>
  );
}

export default function BrowserProfileModalContent() {
  const activeBrowserProfileId = useInterfaceStore((state) => state.activeBrowserProfileId);
  const closeModal = useInterfaceStore((state) => state.closeModal);
  const refreshBrowserList = useInterfaceStore((state) => state.refreshBrowserList);
  const [activeTab, setActiveTab] = useState<BrowserProfileTab>("general");
  const [profile, setProfile] = useState<RemoteBrowserProfileSettings | null>(null);
  const [editorData, setEditorData] = useState<RemoteBrowserProfileEditorData | null>(null);
  const [proxyOptions, setProxyOptions] = useState<RemoteBrowserProxyOption[]>([]);
  const [draft, setDraft] = useState<BrowserProfileDraft | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [userAgentBrowserFilter, setUserAgentBrowserFilter] = useState<string>("all");
  const [userAgentVersionFilter, setUserAgentVersionFilter] = useState<string>(DEFAULT_USER_AGENT_VERSION_FILTER);
  const [userAgentOsFilter, setUserAgentOsFilter] = useState<string>("all");
  const [userAgentDeviceFilter, setUserAgentDeviceFilter] = useState<UserAgentDeviceFilter>(DEFAULT_USER_AGENT_DEVICE_FILTER);
  const [userAgentImportValue, setUserAgentImportValue] = useState<string>("");
  const [userAgentActionMessage, setUserAgentActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!activeBrowserProfileId) {
      setProfile(null);
      setEditorData(null);
      setProxyOptions([]);
      setDraft(null);
      setError(null);
      setSaveMessage(null);
      setUserAgentVersionFilter(DEFAULT_USER_AGENT_VERSION_FILTER);
      setUserAgentImportValue("");
      setUserAgentActionMessage(null);
      return;
    }

    let disposed = false;
    setIsLoading(true);
    setError(null);
    setSaveMessage(null);
    setActiveTab("general");

    void getRemoteBrowserProfileSettings(activeBrowserProfileId)
      .then((result) => {
        if (disposed) {
          return;
        }

        const initialUserAgentFilters = createInitialUserAgentFilters(result.profile, result.editorData);
        setProfile(result.profile);
        setEditorData(result.editorData);
        setProxyOptions(result.proxyOptions);
        setDraft(createDraft(result.profile));
        setUserAgentBrowserFilter(initialUserAgentFilters.browserFamily);
        setUserAgentVersionFilter(initialUserAgentFilters.browserVersion);
        setUserAgentOsFilter(initialUserAgentFilters.osFamily);
        setUserAgentDeviceFilter(initialUserAgentFilters.deviceClass);
        setUserAgentImportValue(result.profile.userAgent ?? "");
        setUserAgentActionMessage(null);
        setIsLoading(false);
      })
      .catch((nextError) => {
        if (disposed) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setIsLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [activeBrowserProfileId]);

  const validationMessage = useMemo(() => (draft ? validateDraft(draft) : null), [draft]);
  const viewportValidationMessage = useMemo(
    () => (draft ? validateDimension(draft.viewportWidth, "Viewport width") ?? validateDimension(draft.viewportHeight, "Viewport height") : null),
    [draft],
  );
  const currentViewportPreset = useMemo(
    () => (draft ? findViewportPresetForDraft(draft, editorData) : null),
    [draft, editorData],
  );
  const currentUserAgentOption = useMemo(
    () => (draft ? findUserAgentOptionForDraft(draft, editorData) : null),
    [draft, editorData],
  );
  const viewportGroups = useMemo(() => {
    const groups = new Map<string, RemoteBrowserViewportPreset[]>();
    for (const preset of editorData?.viewportPresets ?? []) {
      const existingGroup = groups.get(preset.category) ?? [];
      existingGroup.push(preset);
      groups.set(preset.category, existingGroup);
    }

    return [...groups.entries()];
  }, [editorData]);
  const searchEnginePresets = useMemo(
    () => editorData?.searchEnginePresets ?? [],
    [editorData],
  );
  const availableBrowserFamilies = useMemo(
    () => uniqueSorted((editorData?.userAgentOptions ?? []).map((option) => option.browserFamily)),
    [editorData],
  );
  const availableOsFamilies = useMemo(
    () => uniqueSorted((editorData?.userAgentOptions ?? []).map((option) => option.osFamily)),
    [editorData],
  );
  const availableBrowserVersions = useMemo(() => {
    return uniqueSorted((editorData?.userAgentOptions ?? []).flatMap((option) => {
      if (userAgentBrowserFilter !== "all" && option.browserFamily !== userAgentBrowserFilter) {
        return [];
      }

      if (userAgentOsFilter !== "all" && option.osFamily !== userAgentOsFilter) {
        return [];
      }

      if (userAgentDeviceFilter !== "all" && option.deviceClass !== userAgentDeviceFilter) {
        return [];
      }

      return option.browserVersion ? [option.browserVersion] : [];
    }));
  }, [editorData, userAgentBrowserFilter, userAgentDeviceFilter, userAgentOsFilter]);

  useEffect(() => {
    if (userAgentVersionFilter !== DEFAULT_USER_AGENT_VERSION_FILTER && !availableBrowserVersions.includes(userAgentVersionFilter)) {
      setUserAgentVersionFilter(DEFAULT_USER_AGENT_VERSION_FILTER);
    }
  }, [availableBrowserVersions, userAgentVersionFilter]);

  const filteredUserAgentOptions = useMemo(() => {
    return (editorData?.userAgentOptions ?? []).filter((option) => {
      if (userAgentBrowserFilter !== "all" && option.browserFamily !== userAgentBrowserFilter) {
        return false;
      }

      if (userAgentVersionFilter !== DEFAULT_USER_AGENT_VERSION_FILTER && option.browserVersion !== userAgentVersionFilter) {
        return false;
      }

      if (userAgentOsFilter !== "all" && option.osFamily !== userAgentOsFilter) {
        return false;
      }

      if (userAgentDeviceFilter !== "all" && option.deviceClass !== userAgentDeviceFilter) {
        return false;
      }

      return true;
    });
  }, [editorData, userAgentBrowserFilter, userAgentDeviceFilter, userAgentOsFilter, userAgentVersionFilter]);
  const groupedUserAgentOptions = useMemo(() => {
    const groups = new Map<string, { label: string; options: RemoteBrowserUserAgentOption[] }>();
    for (const option of filteredUserAgentOptions) {
      const key = `${option.browserFamily}::${option.osFamily}::${option.deviceClass}`;
      const existingGroup = groups.get(key);
      if (existingGroup) {
        existingGroup.options.push(option);
        continue;
      }

      groups.set(key, {
        label: createUserAgentGroupLabel(option),
        options: [option],
      });
    }

    return [...groups.entries()]
      .map(([id, group]) => ({ id, ...group }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [filteredUserAgentOptions]);

  if (!activeBrowserProfileId) {
    return null;
  }

  async function handleSave(): Promise<void> {
    if (!draft || !profile || validationMessage) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const result = await saveRemoteBrowserProfileSettings(activeBrowserProfileId, {
        headless: draft.headless,
        humanize: draft.humanize,
        locale: normalizeOptionalText(draft.locale),
        name: draft.name.trim(),
        proxySelection: draft.proxyMode === "saved"
          ? { mode: "saved", proxyId: draft.proxyId }
          : { mode: draft.proxyMode },
        searchEngine: normalizeOptionalText(draft.searchEngine),
        timezone: normalizeOptionalText(draft.timezone),
        userAgent: normalizeOptionalText(draft.userAgent),
        userDataDir: normalizeOptionalText(draft.userDataDir),
        viewportHeight: normalizeOptionalDimension(draft.viewportHeight),
        viewportWidth: normalizeOptionalDimension(draft.viewportWidth),
      });

      const initialUserAgentFilters = createInitialUserAgentFilters(result.profile, result.editorData);
      setProfile(result.profile);
      setEditorData(result.editorData);
      setProxyOptions(result.proxyOptions);
      setDraft(createDraft(result.profile));
      setUserAgentBrowserFilter(initialUserAgentFilters.browserFamily);
      setUserAgentVersionFilter(initialUserAgentFilters.browserVersion);
      setUserAgentOsFilter(initialUserAgentFilters.osFamily);
      setUserAgentDeviceFilter(initialUserAgentFilters.deviceClass);
      setUserAgentImportValue(result.profile.userAgent ?? "");
      setUserAgentActionMessage(null);
      setSaveMessage(result.profile.isRunning
        ? "Saved. Restart this browser profile to apply the new settings."
        : "Saved.");
      await refreshBrowserList();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsSaving(false);
    }
  }

  function renderSearchEngineOptions(options: readonly RemoteBrowserSearchEnginePreset[]) {
    return (
      <>
        <option value="">Browser default</option>
        {options.map((option) => (
          <option key={option.id} value={option.value}>
            {option.label}
          </option>
        ))}
      </>
    );
  }

  function applyUserAgentValue(userAgent: string): void {
    const nextValue = userAgent.trim();
    const matchingOption = editorData?.userAgentOptions.find((option) => option.userAgent === nextValue) ?? null;
    setDraft((current) => current ? { ...current, userAgent: nextValue } : current);
    setUserAgentImportValue(nextValue);

    if (matchingOption) {
      setUserAgentBrowserFilter(matchingOption.browserFamily);
      setUserAgentVersionFilter(matchingOption.browserVersion ?? DEFAULT_USER_AGENT_VERSION_FILTER);
      setUserAgentOsFilter(matchingOption.osFamily);
      setUserAgentDeviceFilter(matchingOption.deviceClass);
      return;
    }

    if (nextValue.length === 0) {
      setUserAgentVersionFilter(DEFAULT_USER_AGENT_VERSION_FILTER);
    }
  }

  function handleImportUserAgent(): void {
    const nextValue = userAgentImportValue.trim();
    applyUserAgentValue(nextValue);
    setUserAgentActionMessage(nextValue.length > 0
      ? "Imported the user agent string into this profile draft."
      : "Cleared the override. This profile will use the browser default user agent.");
  }

  async function handleCopyUserAgent(): Promise<void> {
    const currentUserAgent = draft?.userAgent.trim() ?? "";
    if (currentUserAgent.length === 0) {
      setUserAgentActionMessage("Nothing to export yet. Pick a preset or import a user agent string first.");
      return;
    }

    if (!navigator.clipboard?.writeText) {
      setUserAgentActionMessage("Clipboard export is unavailable in this browser context. Use the download action instead.");
      return;
    }

    try {
      await navigator.clipboard.writeText(currentUserAgent);
      setUserAgentActionMessage("Copied the current user agent to the clipboard.");
    } catch (nextError) {
      setUserAgentActionMessage(nextError instanceof Error ? nextError.message : "Clipboard export failed.");
    }
  }

  function handleDownloadUserAgent(): void {
    const currentUserAgent = draft?.userAgent.trim() ?? "";
    if (currentUserAgent.length === 0) {
      setUserAgentActionMessage("Nothing to export yet. Pick a preset or import a user agent string first.");
      return;
    }

    const filenameBase = sanitizeFilenameSegment(draft?.name ?? "") || "browser-profile";
    const blob = new Blob([`${currentUserAgent}\n`], { type: "text/plain;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${filenameBase}-user-agent.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setUserAgentActionMessage("Downloaded the current user agent as a text file.");
  }

  function renderActiveTab() {
    if (!draft) {
      return null;
    }

    if (activeTab === "general") {
      return (
        <Panel title="General" description="Compact profile metadata and launch behavior settings.">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <FieldLabel label="Name" />
              <TextInput value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} />
            </div>
            <div>
              <FieldLabel label="User Data Dir" hint="Relative to the repo data root unless you use an absolute path." />
              <TextInput value={draft.userDataDir} placeholder="profile-65372bfe" onChange={(event) => setDraft((current) => current ? { ...current, userDataDir: event.target.value } : current)} />
            </div>
            <div>
              <FieldLabel label="Timezone" />
              <TextInput value={draft.timezone} placeholder="Europe/Berlin" onChange={(event) => setDraft((current) => current ? { ...current, timezone: event.target.value } : current)} />
            </div>
            <div>
              <FieldLabel label="Locale" />
              <TextInput value={draft.locale} placeholder="en-US" onChange={(event) => setDraft((current) => current ? { ...current, locale: event.target.value } : current)} />
            </div>
            <div className="md:col-span-2">
              <FieldLabel label="Search Engine" />
              <SelectInput value={draft.searchEngine} onChange={(event) => setDraft((current) => current ? { ...current, searchEngine: event.target.value } : current)}>
                {renderSearchEngineOptions(searchEnginePresets)}
              </SelectInput>
            </div>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <CheckboxRow
              checked={draft.headless}
              label="Headless launch"
              description="Run without a visible desktop window on the next launch."
              onChange={(checked) => setDraft((current) => current ? { ...current, headless: checked } : current)}
            />
            <CheckboxRow
              checked={draft.humanize}
              label="Humanize input"
              description="Keep CloakBrowser interaction pacing and natural input enabled."
              onChange={(checked) => setDraft((current) => current ? { ...current, humanize: checked } : current)}
            />
          </div>
        </Panel>
      );
    }

    if (activeTab === "proxy") {
      const proxySelection = describeProxySelection(draft, profile, proxyOptions);
      return (
        <Panel title="Proxy" description="Choose one of the saved ProxyKit profiles for the next browser launch.">
          <div>
            <FieldLabel label="Saved Proxy" hint="This modal edits only saved proxy inventory selections." />
            <SelectInput
              value={getProxySelectValue(draft)}
              onChange={(event) => setDraft((current) => current ? updateProxyDraft(current, event.target.value) : current)}
            >
              <option value={NO_PROXY_VALUE}>No proxy</option>
              {profile?.proxySelection.mode === "preserve" ? (
                <option value={PRESERVE_PROXY_VALUE}>Keep current custom proxy</option>
              ) : null}
              {proxyOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({option.type} {option.endpoint})
                </option>
              ))}
            </SelectInput>
          </div>

          <div className="mt-3 rounded-[12px] bg-black/20 px-3 py-2.5 text-[11px] text-[#8b8b95]">
            <p className="font-medium text-white">Current selection</p>
            <p className="mt-1 leading-relaxed">{proxySelection.label}</p>
            <p className="mt-2 leading-relaxed text-[#73737d]">{proxySelection.detail}</p>
          </div>
        </Panel>
      );
    }

    if (activeTab === "viewport") {
      const viewportSelection = getViewportSelectionSummary(draft, editorData);
      const currentViewportSelectValue = getViewportSelectValue(draft, editorData);
      const hasCustomViewport = currentViewportSelectValue === CUSTOM_VIEWPORT_VALUE;
      const customViewportLabel = draft.viewportWidth.trim().length > 0 && draft.viewportHeight.trim().length > 0
        ? `${draft.viewportWidth.trim()}x${draft.viewportHeight.trim()}`
        : "Current custom viewport";
      return (
        <Panel title="Viewport" description="Persisted browser window and fingerprint dimensions for future launches.">
          <div className="rounded-[12px] bg-black/20 px-3 py-2.5 text-[11px] text-[#8b8b95]">
            <p className="font-medium text-white">Current selection</p>
            <p className="mt-1 leading-relaxed">{viewportSelection.label}</p>
            <p className="mt-2 leading-relaxed text-[#73737d]">{viewportSelection.detail}</p>
          </div>

          <div className="mt-3">
            <FieldLabel label="Device Viewport" hint="Choose a real device/orientation pair, or keep your current custom dimensions." />
            <SelectInput
              value={currentViewportSelectValue}
              onChange={(event) => setDraft((current) => current && editorData ? updateViewportDraft(current, editorData, event.target.value) : current)}
            >
              <option value={BROWSER_DEFAULT_VIEWPORT_VALUE}>Browser default</option>
              {hasCustomViewport ? (
                <option value={CUSTOM_VIEWPORT_VALUE}>Keep current custom viewport ({customViewportLabel})</option>
              ) : null}
              {viewportGroups.map(([category, presets]) => (
                <optgroup key={category} label={category}>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {formatViewportOptionLabel(preset)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </SelectInput>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <FieldLabel label="Custom Width" hint="Advanced fallback when you need a non-preset size." />
              <TextInput value={draft.viewportWidth} placeholder="1440" inputMode="numeric" onChange={(event) => setDraft((current) => current ? { ...current, viewportWidth: event.target.value } : current)} />
            </div>
            <div>
              <FieldLabel label="Custom Height" hint="Leave both width and height empty for browser defaults." />
              <TextInput value={draft.viewportHeight} placeholder="900" inputMode="numeric" onChange={(event) => setDraft((current) => current ? { ...current, viewportHeight: event.target.value } : current)} />
            </div>
          </div>

          {viewportValidationMessage ? (
            <p className="mt-3 text-[11px] text-rose-200">{viewportValidationMessage}</p>
          ) : null}
        </Panel>
      );
    }

    const userAgentSelection = getUserAgentSelectionSummary(draft, editorData);
    return (
      <Panel title="User Agent" description="Grouped preset picker with browser version controls plus direct import and export for custom strings.">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <FieldLabel label="Browser" />
            <SelectInput value={userAgentBrowserFilter} onChange={(event) => setUserAgentBrowserFilter(event.target.value)}>
              <option value="all">All browsers</option>
              {availableBrowserFamilies.map((browserFamily) => (
                <option key={browserFamily} value={browserFamily}>{browserFamily}</option>
              ))}
            </SelectInput>
          </div>
          <div>
            <FieldLabel label="Version" />
            <SelectInput value={userAgentVersionFilter} onChange={(event) => setUserAgentVersionFilter(event.target.value)}>
              <option value={DEFAULT_USER_AGENT_VERSION_FILTER}>All versions</option>
              {availableBrowserVersions.map((browserVersion) => (
                <option key={browserVersion} value={browserVersion}>{browserVersion}</option>
              ))}
            </SelectInput>
          </div>
          <div>
            <FieldLabel label="Operating System" />
            <SelectInput value={userAgentOsFilter} onChange={(event) => setUserAgentOsFilter(event.target.value)}>
              <option value="all">All operating systems</option>
              {availableOsFamilies.map((osFamily) => (
                <option key={osFamily} value={osFamily}>{osFamily}</option>
              ))}
            </SelectInput>
          </div>
          <div>
            <FieldLabel label="Device Class" />
            <SelectInput value={userAgentDeviceFilter} onChange={(event) => setUserAgentDeviceFilter(event.target.value as UserAgentDeviceFilter)}>
              <option value="all">All devices</option>
              <option value="desktop">Desktop</option>
              <option value="tablet">Tablet</option>
              <option value="mobile">Mobile</option>
            </SelectInput>
          </div>
        </div>

        <div className="mt-3 rounded-[12px] bg-black/20 px-3 py-2.5 text-[11px] text-[#8b8b95]">
          <p className="font-medium text-white">Current selection</p>
          <p className="mt-1 leading-relaxed">{userAgentSelection.label}</p>
          <p className="mt-2 truncate text-[10px] text-[#73737d]">{userAgentSelection.detail}</p>
        </div>

        <div className="mt-3 rounded-[12px] bg-black/10 p-3">
          <FieldLabel label="Import From String" hint="Paste a raw UA string, apply it to the draft, or revert back to the browser default." />
          <TextareaInput
            rows={4}
            spellCheck={false}
            value={userAgentImportValue}
            placeholder="Mozilla/5.0 ..."
            onChange={(event) => setUserAgentImportValue(event.target.value)}
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleImportUserAgent}
              className="rounded-[12px] bg-white/[0.08] px-3 py-2 text-[11px] font-medium text-white transition hover:bg-white/[0.12]"
            >
              Import String
            </button>
            <button
              type="button"
              onClick={() => {
                applyUserAgentValue("");
                setUserAgentActionMessage("Reverted to the browser default user agent.");
              }}
              className="rounded-[12px] bg-white/[0.04] px-3 py-2 text-[11px] font-medium text-[#d8d8dd] transition hover:bg-white/[0.08] hover:text-white"
            >
              Use Browser Default
            </button>
            <button
              type="button"
              onClick={() => { void handleCopyUserAgent(); }}
              disabled={draft.userAgent.trim().length === 0}
              className="rounded-[12px] bg-white/[0.04] px-3 py-2 text-[11px] font-medium text-[#d8d8dd] transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Copy Current UA
            </button>
            <button
              type="button"
              onClick={handleDownloadUserAgent}
              disabled={draft.userAgent.trim().length === 0}
              className="rounded-[12px] bg-white/[0.04] px-3 py-2 text-[11px] font-medium text-[#d8d8dd] transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Download .txt
            </button>
          </div>

          {userAgentActionMessage ? (
            <p className="mt-3 text-[11px] leading-relaxed text-[#9e9ea7]">{userAgentActionMessage}</p>
          ) : (
            <p className="mt-3 text-[11px] leading-relaxed text-[#7d7d87]">Paste a raw UA string when you want to override the preset catalog manually.</p>
          )}
        </div>

        <div className="mt-3 max-h-[30vh] space-y-2 overflow-auto pr-1">
          {groupedUserAgentOptions.length > 0 ? (
            groupedUserAgentOptions.map((group) => (
              <section key={group.id} className="rounded-[12px] bg-black/10 p-2">
                <p className="px-1 text-[10px] uppercase tracking-[0.16em] text-[#6f6f79]">{group.label}</p>
                <div className="mt-2 space-y-1">
                  {group.options.map((option) => {
                    const active = currentUserAgentOption?.userAgent === option.userAgent;
                    return (
                      <button
                        key={option.userAgent}
                        type="button"
                        onClick={() => {
                          applyUserAgentValue(option.userAgent);
                          setUserAgentActionMessage(`Selected ${option.label}.`);
                        }}
                        className={`w-full rounded-[12px] px-3 py-2 text-left transition ${active ? "bg-white/[0.1] text-white" : "bg-black/20 text-[#d6d6db] hover:bg-black/25"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[11px] font-medium">{option.label}</p>
                          <span className="rounded-full bg-black/20 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#94949d]">
                            {formatBrowserVersionLabel(option.browserVersion)}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] text-[#75757f]">{option.browserFamily} · {option.osFamily} · {formatDeviceClassLabel(option.deviceClass)}</p>
                        <p className="mt-1 truncate text-[10px] text-[#666670]">{option.userAgent}</p>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          ) : (
            <div className="rounded-[12px] bg-black/10 px-3 py-2 text-[11px] text-[#7d7d87]">
              No presets match the current browser, version, operating system, and device filters.
            </div>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <div className="flex min-h-[56vh] flex-col gap-3">
      {error ? (
        <div className="rounded-[14px] bg-red-500/10 px-3 py-2.5 text-[12px] text-red-100">
          {error}
        </div>
      ) : null}

      {saveMessage ? (
        <div className="rounded-[14px] bg-emerald-500/10 px-3 py-2.5 text-[12px] text-emerald-100">
          {saveMessage}
        </div>
      ) : null}

      {isLoading && !draft ? (
        <div className="flex grow items-center justify-center rounded-[16px] bg-white/[0.03] text-[12px] text-[#8b8b95]">
          Loading browser profile settings...
        </div>
      ) : draft ? (
        <>
          <div className="flex flex-wrap items-center gap-1 rounded-[14px] bg-white/[0.03] p-1">
            {BROWSER_PROFILE_TABS.map((tab) => (
              <TabButton
                key={tab.id}
                active={activeTab === tab.id}
                label={tab.label}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </div>

          {renderActiveTab()}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-2.5">
            <p className="text-[11px] text-[#8b8b95]">{validationMessage ?? "Save the profile now, then stop and relaunch it when you want the new settings to take effect."}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-[12px] bg-white/[0.06] px-4 py-2 text-[11px] font-medium text-white transition hover:bg-white/[0.1]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => { void handleSave(); }}
                disabled={isSaving || Boolean(validationMessage)}
                className="rounded-[12px] bg-white px-4 py-2 text-[11px] font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex grow items-center justify-center rounded-[16px] bg-white/[0.03] text-[12px] text-[#8b8b95]">
          Unable to load browser profile settings.
        </div>
      )}
    </div>
  );
}