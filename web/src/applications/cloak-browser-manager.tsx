import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { type RemoteBrowserProfileEntry } from "../api/client";
import { BrowserLivePreview } from "../components/BrowserPreviewModal";
import workbookTheme from "../theme.tsx";
import { useInterfaceStore } from "../store/ui";
import { defineApplication, type ApplicationViewProps } from "./application";
import {
  ApplicationActionButton,
  ApplicationEmptyState,
  ApplicationHeader,
  ApplicationMetaRow,
  ApplicationPanel,
  ApplicationSurface,
} from "./application-layout.tsx";

export const CLOAK_BROWSERS_APPLICATION_ID = "applications/cloak-browsers";

export type CloakBrowsersInput = {
  selectedProfileId?: string | null;
};

export function createCloakBrowsersInstanceTitle(profileName?: string | null): string {
  const trimmedProfileName = profileName?.trim() ?? "";
  return trimmedProfileName.length > 0
    ? `Cloak Browsers · ${trimmedProfileName}`
    : "Cloak Browsers · grid";
}

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");
}

function getAddressBarDisplayParts(input: string): {
  host: string;
  path: string;
  search: string;
  rawValue: string;
} {
  const rawValue = input.trim();
  if (rawValue.length === 0) {
    return { host: "", path: "", search: "", rawValue: "" };
  }

  try {
    const parsedUrl = new URL(rawValue);
    const host = parsedUrl.host || parsedUrl.hostname || rawValue;
    const path = parsedUrl.pathname === "/" ? "" : parsedUrl.pathname;
    const search = `${parsedUrl.search}${parsedUrl.hash}`;
    return { host, path, search, rawValue };
  } catch {
    const withoutProtocol = rawValue.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "");
    const delimiterIndex = withoutProtocol.search(/[/?#]/u);
    if (delimiterIndex === -1) {
      return { host: withoutProtocol, path: "", search: "", rawValue };
    }

    const remainder = withoutProtocol.slice(delimiterIndex);
    const searchIndex = remainder.search(/[?#]/u);
    const path = searchIndex === -1 ? remainder : remainder.slice(0, searchIndex);
    const search = searchIndex === -1 ? "" : remainder.slice(searchIndex);

    return {
      host: withoutProtocol.slice(0, delimiterIndex) || withoutProtocol,
      path,
      search,
      rawValue,
    };
  }
}

function ChromeToolbarButton({
  title,
  onClick,
  disabled = false,
  tone = "default",
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary" | "ghost";
  children: ReactNode;
}) {
  const toneClass = tone === "danger"
    ? "bg-[#352021] text-[#f3d6d8] hover:bg-[#442728]"
    : tone === "primary"
      ? "bg-[#2c2c2e] text-white hover:bg-[#363639]"
      : tone === "ghost"
        ? "bg-transparent text-[#9ea3ae] hover:text-white"
      : "bg-[#212123] text-[#d0d0d4] hover:bg-[#2a2a2d] hover:text-white";

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={joinClassNames(
        "flex h-8 w-8 items-center justify-center rounded-[10px] transition disabled:opacity-40",
        toneClass,
      )}
    >
      {children}
    </button>
  );
}

type BrowserGridCardProps = {
  profile: RemoteBrowserProfileEntry;
  isLivePreviewActive: boolean;
  isLaunching: boolean;
  isStopping: boolean;
  isNavigating: boolean;
  onActivateLivePreview: () => void;
  onLaunch: () => void;
  onStop: () => void;
  onNavigate: (url: string) => void;
  onOpenSettings: () => void;
};

function BrowserGridCard({
  profile,
  isLivePreviewActive,
  isLaunching,
  isStopping,
  isNavigating,
  onActivateLivePreview,
  onLaunch,
  onStop,
  onNavigate,
  onOpenSettings,
}: BrowserGridCardProps) {
  const [navigateUrl, setNavigateUrl] = useState<string>(profile.currentUrl ?? "https://www.startpage.com/");
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const isEditingUrlRef = useRef(false);
  const openContextMenu = useInterfaceStore((state) => state.openContextMenu);
  const addressBarDisplay = useMemo(() => getAddressBarDisplayParts(navigateUrl), [navigateUrl]);

  useEffect(() => {
    if (!isEditingUrlRef.current) {
      setNavigateUrl(profile.currentUrl ?? "https://www.startpage.com/");
    }
  }, [profile.currentUrl, profile.id]);

  useEffect(() => {
    if (!isEditingUrl) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    });

    return () => cancelAnimationFrame(frameId);
  }, [isEditingUrl]);

  function submitNavigate(): void {
    const trimmedUrl = navigateUrl.trim();
    if (!profile.isRunning || trimmedUrl.length === 0 || isNavigating) {
      return;
    }

    onNavigate(trimmedUrl);
    isEditingUrlRef.current = false;
    setIsEditingUrl(false);
  }

  function handleProfileMenu(event: MouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();

    const bounds = event.currentTarget.getBoundingClientRect();
    openContextMenu({
      x: event.type === "contextmenu" ? event.clientX : bounds.left,
      y: event.type === "contextmenu" ? event.clientY : bounds.bottom + 8,
      items: [
        {
          id: `${profile.id}-toggle-runtime`,
          label: profile.isRunning
            ? (isStopping ? "Stopping profile..." : "Stop profile")
            : (isLaunching ? "Launching profile..." : "Launch profile"),
          disabled: profile.isRunning ? isStopping : isLaunching,
          tone: profile.isRunning ? "danger" : "accent",
          onSelect: () => {
            if (profile.isRunning) {
              onStop();
              return;
            }

            onLaunch();
          },
        },
        {
          id: `${profile.id}-settings`,
          label: "Profile settings",
          onSelect: onOpenSettings,
        },
      ],
    });
  }

  return (
    <div className="flex min-h-[440px] flex-col">
      <div className="min-h-0 flex-1">
        {profile.isRunning && !isLivePreviewActive ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[14px] bg-[#111112]">
            <div className="bg-[#1a1a1b] px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleProfileMenu}
                  onContextMenu={handleProfileMenu}
                  className="flex min-w-0 max-w-[160px] shrink items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] text-[#cfd1d6] transition hover:bg-white/[0.05] hover:text-white"
                  title={profile.name}
                >
                  <span className="truncate font-medium">{profile.name}</span>
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                <div className="min-w-0 flex-1 truncate rounded-full bg-[#141414] px-4 py-1.5 text-[11px] text-[#7d828d]" title={addressBarDisplay.rawValue || profile.currentUrl || profile.name}>
                  {addressBarDisplay.rawValue || profile.currentUrl || profile.name}
                </div>

                <button
                  type="button"
                  onClick={onActivateLivePreview}
                  className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white transition hover:bg-white/[0.12]"
                >
                  Live
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={onActivateLivePreview}
              className="flex h-[420px] w-full flex-1 flex-col items-center justify-center gap-2 bg-black/20 px-6 text-center text-[#9ea3ae] transition hover:text-white"
            >
              <span className="text-[12px] font-medium text-white">Live preview paused</span>
              <span className="text-[11px] text-[#7a7f8b]">Only one profile streams live at a time in the grid.</span>
              <span className="max-w-[320px] truncate text-[11px] text-[#6b7280]">{profile.currentUrl ?? "Activate this card to resume preview and interaction."}</span>
            </button>
          </div>
        ) : (
          <BrowserLivePreview
            profile={profile}
            className="min-h-0 flex-1"
            suppressLiveStatusUpdates
            inactiveState={(
              <button
                type="button"
                onClick={onLaunch}
                disabled={isLaunching}
                className="flex h-[420px] w-full flex-col items-center justify-center gap-2 text-center text-[#9ea3ae] transition hover:text-white disabled:cursor-wait disabled:opacity-60"
              >
                <span className="text-[12px] font-medium text-white">
                  {isLaunching ? "Launching profile..." : "Profile not running"}
                </span>
                <span className="text-[11px] text-[#7a7f8b]">
                  {isLaunching ? "Browser runtime is starting." : "Click to run"}
                </span>
              </button>
            )}
            toolbar={(controls) => (
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-0.5">
                  <ChromeToolbarButton
                    title={controls.isLoading ? "Updating preview" : "Refresh preview"}
                    onClick={controls.refresh}
                    disabled={!controls.canInteract || controls.isLoading}
                    tone="ghost"
                  >
                    <svg viewBox="0 0 24 24" className={joinClassNames("h-3.5 w-3.5", controls.isLoading ? "animate-spin" : undefined)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      <path d="M21 3v6h-6" />
                    </svg>
                  </ChromeToolbarButton>
                </div>

                <button
                  type="button"
                  onClick={handleProfileMenu}
                  onContextMenu={handleProfileMenu}
                  className={joinClassNames(
                    "flex min-w-0 max-w-[160px] shrink items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] text-[#cfd1d6] transition hover:bg-white/[0.05] hover:text-white",
                    !controls.canInteract && "text-[#8b8f98]",
                  )}
                  title={profile.name}
                >
                  <span className="truncate font-medium">{profile.name}</span>
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                <div className="flex min-w-0 flex-1 items-center rounded-full bg-[#141414] px-4 py-1.5">
                  {isEditingUrl ? (
                    <input
                      ref={urlInputRef}
                      type="text"
                      value={navigateUrl}
                      onChange={(event) => setNavigateUrl(event.target.value)}
                      onFocus={() => {
                        isEditingUrlRef.current = true;
                      }}
                      onBlur={() => {
                        isEditingUrlRef.current = false;
                        setIsEditingUrl(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitNavigate();
                          return;
                        }

                        if (event.key === "Escape") {
                          event.preventDefault();
                          isEditingUrlRef.current = false;
                          setNavigateUrl(profile.currentUrl ?? "https://www.startpage.com/");
                          setIsEditingUrl(false);
                        }
                      }}
                      placeholder="https://example.com"
                      disabled={!profile.isRunning}
                      className="min-w-0 flex-1 bg-transparent text-[11px] text-white outline-none placeholder:text-[#6e7380] disabled:opacity-50"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (!profile.isRunning) {
                          return;
                        }

                        isEditingUrlRef.current = true;
                        setIsEditingUrl(true);
                      }}
                      disabled={!profile.isRunning}
                      title={addressBarDisplay.rawValue || "https://example.com"}
                      className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden bg-transparent text-left disabled:cursor-default disabled:opacity-50"
                    >
                      {controls.activeFaviconUrl ? (
                        <img
                          src={controls.activeFaviconUrl}
                          alt=""
                          className="h-4 w-4 shrink-0 rounded-[4px] object-contain"
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-white/[0.06] text-[#a4a8b2]">
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="8" />
                            <path d="M4 12h16" />
                            <path d="M12 4a12.3 12.3 0 0 1 0 16" />
                            <path d="M12 4a12.3 12.3 0 0 0 0 16" />
                          </svg>
                        </span>
                      )}

                      {addressBarDisplay.host ? (
                        <>
                          <span className="truncate text-[11px] text-white">{addressBarDisplay.host}</span>
                          {addressBarDisplay.path ? (
                            <span className="truncate text-[11px] text-[#7d828d]">{addressBarDisplay.path}</span>
                          ) : null}
                          {addressBarDisplay.search ? (
                            <span className="truncate text-[11px] text-[#5f6571]">{addressBarDisplay.search}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="truncate text-[11px] text-[#6e7380]">https://example.com</span>
                      )}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <ChromeToolbarButton
                    title={controls.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                    onClick={controls.toggleFullscreen}
                    tone="ghost"
                  >
                    {controls.isFullscreen ? (
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
                    )}
                  </ChromeToolbarButton>
                </div>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}

function CloakBrowsersApplicationView({ instance, setTitle }: ApplicationViewProps<CloakBrowsersInput>) {
  const browserProfiles = useInterfaceStore((state) => state.browserProfiles);
  const isBrowserLoading = useInterfaceStore((state) => state.isBrowserLoading);
  const browserActionTarget = useInterfaceStore((state) => state.browserActionTarget);
  const browserActionKind = useInterfaceStore((state) => state.browserActionKind);
  const refreshBrowserList = useInterfaceStore((state) => state.refreshBrowserList);
  const launchBrowserProfile = useInterfaceStore((state) => state.launchBrowserProfile);
  const stopBrowserProfile = useInterfaceStore((state) => state.stopBrowserProfile);
  const navigateBrowserProfile = useInterfaceStore((state) => state.navigateBrowserProfile);
  const openBrowserProfileModal = useInterfaceStore((state) => state.openBrowserProfileModal);
  const openCommandPalette = useInterfaceStore((state) => state.openCommandPalette);
  const preferredPreviewProfileId = instance.input.selectedProfileId?.trim() || null;
  const [activePreviewProfileId, setActivePreviewProfileId] = useState<string | null>(preferredPreviewProfileId);

  const sortedProfiles = useMemo(() => {
    return [...browserProfiles].sort((left, right) => {
      if (left.isRunning === right.isRunning) {
        return left.name.localeCompare(right.name);
      }
      return left.isRunning ? -1 : 1;
    });
  }, [browserProfiles]);

  const runningCount = useMemo(
    () => browserProfiles.reduce((count, profile) => count + (profile.isRunning ? 1 : 0), 0),
    [browserProfiles],
  );

  const proxiedCount = useMemo(
    () => browserProfiles.reduce((count, profile) => count + (profile.proxy ? 1 : 0), 0),
    [browserProfiles],
  );

  const headlessCount = useMemo(
    () => browserProfiles.reduce((count, profile) => count + (profile.headless ? 1 : 0), 0),
    [browserProfiles],
  );

  const humanizedCount = useMemo(
    () => browserProfiles.reduce((count, profile) => count + (profile.humanize ? 1 : 0), 0),
    [browserProfiles],
  );

  useEffect(() => {
    setTitle(createCloakBrowsersInstanceTitle());
  }, [setTitle]);

  useEffect(() => {
    void refreshBrowserList();
  }, [refreshBrowserList]);

  useEffect(() => {
    const runningProfiles = sortedProfiles.filter((profile) => profile.isRunning);
    if (runningProfiles.length === 0) {
      if (activePreviewProfileId !== null) {
        setActivePreviewProfileId(null);
      }
      return;
    }

    if (activePreviewProfileId && runningProfiles.some((profile) => profile.id === activePreviewProfileId)) {
      return;
    }

    const preferredRunningProfile = preferredPreviewProfileId
      ? runningProfiles.find((profile) => profile.id === preferredPreviewProfileId)
      : null;
    setActivePreviewProfileId(preferredRunningProfile?.id ?? runningProfiles[0]!.id);
  }, [activePreviewProfileId, preferredPreviewProfileId, sortedProfiles]);

  if (!isBrowserLoading && sortedProfiles.length === 0) {
    return (
      <ApplicationSurface>
        <ApplicationHeader
          title="Cloak Browsers"
          subtitle="Virtual browser grid with live preview for every discovered profile."
          actions={(
            <>
              <ApplicationActionButton onClick={() => { void refreshBrowserList(); }}>
                Refresh Profiles
              </ApplicationActionButton>
              <ApplicationActionButton onClick={openCommandPalette}>
                Command Palette
              </ApplicationActionButton>
            </>
          )}
          meta={(
            <ApplicationMetaRow>
              <span>profiles 0</span>
              <span>running 0</span>
              <span>proxied 0</span>
            </ApplicationMetaRow>
          )}
        />

        <div className="pt-2">
          <ApplicationPanel title="Browser Grid" subtitle="Every discovered browser renders directly in the grid.">
            <div className={`rounded-[16px] ${workbookTheme.surface.panel} px-4 py-5 text-center`}>
              <p className={`text-[12px] font-medium ${workbookTheme.text.primary}`}>No Cloak Browser profiles found.</p>
              <p className={`mt-2 text-[11px] leading-relaxed ${workbookTheme.text.secondary}`}>
                Refresh the runtime list or open the command palette to create browser tooling before rendering the grid.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <ApplicationActionButton onClick={() => { void refreshBrowserList(); }}>
                  Refresh Profiles
                </ApplicationActionButton>
                <ApplicationActionButton onClick={openCommandPalette} className={workbookTheme.interaction.buttonSubtle}>
                  Command Palette
                </ApplicationActionButton>
              </div>
            </div>
          </ApplicationPanel>
        </div>
      </ApplicationSurface>
    );
  }

  return (
    <ApplicationSurface>
      <ApplicationHeader
        title="Cloak Browsers"
        subtitle="Grid-native virtual browsers with one live preview at a time."
        actions={(
          <>
            <ApplicationActionButton
              onClick={() => { void refreshBrowserList(); }}
              disabled={isBrowserLoading}
            >
              {isBrowserLoading ? "Refreshing..." : "Refresh Profiles"}
            </ApplicationActionButton>
            <ApplicationActionButton onClick={openCommandPalette}>
              Command Palette
            </ApplicationActionButton>
          </>
        )}
        meta={(
          <ApplicationMetaRow>
            <span>profiles {browserProfiles.length}</span>
            <span>running {runningCount}</span>
            <span>proxied {proxiedCount}</span>
            <span>headless {headlessCount}</span>
            <span>humanized {humanizedCount}</span>
            <span>grid 2-3 cols</span>
          </ApplicationMetaRow>
        )}
      />

      <div className="min-h-0 flex-1 pt-2">
        <ApplicationPanel
          title="Browser Grid"
          subtitle="Operate every profile directly in place without profile selection."
          className="min-h-0 flex-1"
        >
          <div className="min-h-0 overflow-auto pr-1">
            <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {sortedProfiles.map((profile) => (
                <BrowserGridCard
                  key={profile.id}
                  profile={profile}
                  isLivePreviewActive={profile.id === activePreviewProfileId}
                  isLaunching={browserActionTarget === profile.id && browserActionKind === "launch"}
                  isStopping={browserActionTarget === profile.id && browserActionKind === "stop"}
                  isNavigating={browserActionTarget === profile.id && browserActionKind === "navigate"}
                  onActivateLivePreview={() => setActivePreviewProfileId(profile.id)}
                  onLaunch={() => {
                    setActivePreviewProfileId(profile.id);
                    void launchBrowserProfile(profile.id);
                  }}
                  onStop={() => { void stopBrowserProfile(profile.id); }}
                  onNavigate={(url) => { void navigateBrowserProfile(profile.id, url); }}
                  onOpenSettings={() => openBrowserProfileModal(profile.id)}
                />
              ))}
            </div>
          </div>
        </ApplicationPanel>
      </div>
    </ApplicationSurface>
  );
}

export const cloakBrowsersApplication = defineApplication<CloakBrowsersInput>({
  id: CLOAK_BROWSERS_APPLICATION_ID,
  title: "Cloak Browsers",
  View: CloakBrowsersApplicationView,
});