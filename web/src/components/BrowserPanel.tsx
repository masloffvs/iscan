import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { captureRemoteCloakBrowserScreenshot, type RemoteBrowserProfileEntry } from "../api/client";
import { useInterfaceStore } from "../store/ui";
import BrowserPreviewModal from "./BrowserPreviewModal";

function describeProfile(profile: RemoteBrowserProfileEntry): string {
  const details = [profile.headless ? "Headless" : "Headful"];
  if (profile.humanize) {
    details.push("Humanize");
  }
  if (profile.userDataDir) {
    details.push(profile.userDataDir);
  }
  return details.join(" · ");
}

export default function BrowserPanel() {
  const browserProfiles = useInterfaceStore((state) => state.browserProfiles);
  const isBrowserLoading = useInterfaceStore((state) => state.isBrowserLoading);
  const browserActionTarget = useInterfaceStore((state) => state.browserActionTarget);
  const browserActionKind = useInterfaceStore((state) => state.browserActionKind);
  const refreshBrowserList = useInterfaceStore((state) => state.refreshBrowserList);
  const launchBrowserProfile = useInterfaceStore((state) => state.launchBrowserProfile);
  const stopBrowserProfile = useInterfaceStore((state) => state.stopBrowserProfile);
  const navigateBrowserProfile = useInterfaceStore((state) => state.navigateBrowserProfile);
  const openBrowserProfileModal = useInterfaceStore((state) => state.openBrowserProfileModal);
  const [selectedBrowserId, setSelectedBrowserId] = useState<string>("");
  const [previewBrowserId, setPreviewBrowserId] = useState<string | null>(null);
  const [navigateUrl, setNavigateUrl] = useState<string>("https://www.startpage.com/");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isScreenshotLoading, setIsScreenshotLoading] = useState<boolean>(false);

  const sortedProfiles = useMemo(() => {
    return [...browserProfiles].sort((left, right) => {
      if (left.isRunning === right.isRunning) {
        return left.name.localeCompare(right.name);
      }
      return left.isRunning ? -1 : 1;
    });
  }, [browserProfiles]);

  const selectedProfile = useMemo(() => {
    return sortedProfiles.find((profile) => profile.id === selectedBrowserId) ?? sortedProfiles[0] ?? null;
  }, [selectedBrowserId, sortedProfiles]);

  const previewProfile = useMemo(() => {
    return sortedProfiles.find((profile) => profile.id === previewBrowserId) ?? null;
  }, [previewBrowserId, sortedProfiles]);

  useEffect(() => {
    if (sortedProfiles.length === 0) {
      setSelectedBrowserId("");
      return;
    }

    if (!sortedProfiles.some((profile) => profile.id === selectedBrowserId)) {
      setSelectedBrowserId(sortedProfiles[0]?.id ?? "");
    }
  }, [selectedBrowserId, sortedProfiles]);

  useEffect(() => {
    if (!selectedProfile) {
      setNavigateUrl("https://www.startpage.com/");
      return;
    }

    setNavigateUrl(selectedProfile.currentUrl ?? "https://www.startpage.com/");
  }, [selectedProfile?.currentUrl, selectedProfile?.id]);

  useEffect(() => {
    let disposed = false;

    if (!selectedProfile?.isRunning) {
      setScreenshotUrl(null);
      setIsScreenshotLoading(false);
      return;
    }

    setIsScreenshotLoading(true);
    void captureRemoteCloakBrowserScreenshot(selectedProfile.id)
      .then((nextScreenshotUrl) => {
        if (disposed) {
          return;
        }

        setScreenshotUrl(nextScreenshotUrl);
        setIsScreenshotLoading(false);
      })
      .catch(() => {
        if (disposed) {
          return;
        }

        setScreenshotUrl(null);
        setIsScreenshotLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [browserProfiles, selectedProfile?.currentUrl, selectedProfile?.id, selectedProfile?.isRunning]);

  function renderActionIcon(kind: "launch" | "stop", active: boolean) {
    if (active) {
      return (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" />
        </svg>
      );
    }

    if (kind === "launch") {
      return (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
          <path d="M8 5.14v13.72c0 .77.83 1.25 1.5.86l10-6.86a1 1 0 0 0 0-1.72l-10-6.86A1 1 0 0 0 8 5.14Z" />
        </svg>
      );
    }

    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="2" />
      </svg>
    );
  }

  function renderSettingsIcon() {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M10.31 4.93a1 1 0 0 1 1.38-.36l.6.35a1 1 0 0 0 1 0l.6-.35a1 1 0 0 1 1.38.36l.5.86a1 1 0 0 0 .87.5h.69a1 1 0 0 1 1 1v1a1 1 0 0 0 .5.87l.6.35a1 1 0 0 1 .36 1.37l-.35.61a1 1 0 0 0 0 1l.35.6a1 1 0 0 1-.36 1.38l-.6.35a1 1 0 0 0-.5.87v.69a1 1 0 0 1-1 1h-.69a1 1 0 0 0-.87.5l-.5.86a1 1 0 0 1-1.38.36l-.6-.35a1 1 0 0 0-1 0l-.6.35a1 1 0 0 1-1.38-.36l-.5-.86a1 1 0 0 0-.87-.5h-.69a1 1 0 0 1-1-1v-.69a1 1 0 0 0-.5-.87l-.6-.35a1 1 0 0 1-.36-1.38l.35-.6a1 1 0 0 0 0-1l-.35-.61a1 1 0 0 1 .36-1.37l.6-.35a1 1 0 0 0 .5-.87v-1a1 1 0 0 1 1-1h.69a1 1 0 0 0 .87-.5l.5-.86Z" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  function actionButtonTone(isRunning: boolean): string {
    return isRunning
      ? "bg-emerald-500/18 text-emerald-300 hover:bg-emerald-500/28"
      : "bg-white/[0.08] text-white hover:bg-white/[0.12]";
  }

  return (
    <div className="grow overflow-y-auto dense-scroll px-1">
      <div className="mb-3 flex items-center justify-between gap-3 px-2">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[#68686e]">Cloak Browsers</p>
        <button
          type="button"
          onClick={() => { void refreshBrowserList(); }}
          disabled={isBrowserLoading}
          className="rounded-full bg-white/[0.06] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-white transition hover:bg-white/[0.1] disabled:opacity-50"
        >
          {isBrowserLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {isBrowserLoading ? (
        <div className="px-2 py-3 text-[11px] text-[#68686e]">Loading browser profiles...</div>
      ) : sortedProfiles.length === 0 ? (
        <div className="space-y-3 px-2 py-3 text-[11px] text-[#68686e]">
          <p>No Cloak Browser profiles found.</p>
          <p>Use <code className="rounded bg-white/[0.04] px-1 py-0.5 text-[10px]">$.kits.cloak.manager()</code> to create one.</p>
        </div>
      ) : (
        <div className="space-y-3 px-1 pb-2">
          {selectedProfile ? (
            <div className="rounded-[20px] bg-white/[0.02] p-2.5">
              <div className="mb-2 px-1">
                <p className="truncate text-[12px] font-medium text-white">{selectedProfile.name}</p>
                <p className="truncate text-[10px] text-[#72727c]">{selectedProfile.currentUrl ?? describeProfile(selectedProfile)}</p>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (selectedProfile.isRunning) {
                    setPreviewBrowserId(selectedProfile.id);
                  }
                }}
                disabled={!selectedProfile.isRunning}
                className="block w-full overflow-hidden rounded-[16px] bg-black/30 text-left disabled:cursor-default"
              >
                {selectedProfile.isRunning ? (
                  screenshotUrl ? (
                    <img src={screenshotUrl} alt={`${selectedProfile.name} screenshot`} className="aspect-[16/10] h-full w-full object-cover transition hover:scale-[1.01]" />
                  ) : (
                    <div className="flex aspect-[16/10] h-full items-center justify-center text-[11px] text-[#6d6d78]">
                      {isScreenshotLoading ? "Capturing screenshot..." : "No screenshot yet."}
                    </div>
                  )
                ) : (
                  <div className="flex aspect-[16/10] h-full items-center justify-center text-[11px] text-[#6d6d78]">
                    Launch the browser to see a live screenshot.
                  </div>
                )}
              </button>

              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={navigateUrl}
                  onChange={(event) => setNavigateUrl(event.target.value)}
                  placeholder="https://..."
                  disabled={!selectedProfile.isRunning}
                  className="min-w-0 flex-1 rounded-full bg-black/20 px-3 py-2 text-[11px] text-white placeholder:text-[#6d6d78] outline-none transition disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => { void navigateBrowserProfile(selectedProfile.id, navigateUrl.trim()); }}
                  disabled={!selectedProfile.isRunning || navigateUrl.trim().length === 0 || (browserActionTarget === selectedProfile.id && browserActionKind === "navigate")}
                  className="rounded-full bg-white/[0.08] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white transition hover:bg-white/[0.12] disabled:opacity-50"
                >
                  {browserActionTarget === selectedProfile.id && browserActionKind === "navigate" ? "Loading..." : "Go"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-[20px] bg-white/[0.02]">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col className="w-[40%]" />
                <col className="w-[42%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[#68686e]">
                  <th className="px-3 py-2 font-medium">Browser</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedProfiles.map((profile, index) => {
                  const isSelected = profile.id === selectedProfile?.id;
                  const isLaunchPending = browserActionTarget === profile.id && browserActionKind === "launch";
                  const isStopPending = browserActionTarget === profile.id && browserActionKind === "stop";
                  return (
                    <tr
                      key={profile.id}
                      onClick={() => setSelectedBrowserId(profile.id)}
                      className={`cursor-pointer align-top text-[11px] transition ${isSelected ? "bg-white/[0.07]" : index % 2 === 0 ? "bg-transparent hover:bg-white/[0.03]" : "bg-white/[0.015] hover:bg-white/[0.03]"}`}
                    >
                      <td className="px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white">{profile.name}</p>
                          <p className="truncate text-[10px] text-[#72727c]">{profile.id}</p>
                          <p className="truncate text-[10px] text-[#8b8b95]">{describeProfile(profile)}</p>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[#8f8f98]">
                        <p className="truncate">{profile.currentUrl ?? profile.userDataDir ?? "Idle"}</p>
                        {profile.proxy ? <p className="truncate text-[10px] text-[#6f6f79]">{profile.proxy}</p> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openBrowserProfileModal(profile.id);
                            }}
                            title="Browser settings"
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.05] text-[#b7b7c0] transition hover:bg-white/[0.1] hover:text-white"
                          >
                            {renderSettingsIcon()}
                          </button>
                          {profile.isRunning ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void stopBrowserProfile(profile.id);
                              }}
                              disabled={isStopPending}
                              title="Stop browser"
                              className={`flex h-7 w-7 items-center justify-center rounded-full transition disabled:opacity-50 ${actionButtonTone(true)}`}
                            >
                              {renderActionIcon("stop", isStopPending)}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void launchBrowserProfile(profile.id);
                              }}
                              disabled={isLaunchPending}
                              title="Launch browser"
                              className={`flex h-7 w-7 items-center justify-center rounded-full transition disabled:opacity-50 ${actionButtonTone(false)}`}
                            >
                              {renderActionIcon("launch", isLaunchPending)}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {previewProfile ? (
          <BrowserPreviewModal
            profile={previewProfile}
            onClose={() => setPreviewBrowserId(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
