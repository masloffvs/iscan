import { useEffect, useState, type ReactNode } from "react";
import Modal from "./Modal";
import type { RemoteBrowserProfileEntry, RemoteBrowserTabEntry } from "../api/client";
import { useBrowserLivePreviewController } from "./BrowserLivePreviewController";
import { useInterfaceStore } from "../store/ui";

type BrowserPreviewModalProps = {
  profile: RemoteBrowserProfileEntry;
  onClose: () => void;
};

type BrowserLivePreviewProps = {
  profile: RemoteBrowserProfileEntry;
  className?: string;
  inactiveState?: ReactNode;
  suppressLiveStatusUpdates?: boolean;
  toolbar?: (controls: {
    activeTitle: string;
    activeFaviconUrl: string | null;
    status: string;
    isLoading: boolean;
    isFullscreen: boolean;
    canInteract: boolean;
    refresh: () => void;
    refreshTabs: () => void;
    toggleFullscreen: () => void;
  }) => ReactNode;
};

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");
}

function summarizeTab(tab: RemoteBrowserTabEntry): string {
  const text = tab.title?.trim() || tab.url.trim() || tab.id;
  return text.length > 0 ? text : tab.id;
}

function getTabFaviconUrl(tab: RemoteBrowserTabEntry): string | null {
  const payloadFaviconUrl = tab.faviconUrl?.trim();
  if (payloadFaviconUrl) {
    return payloadFaviconUrl;
  }

  const trimmedUrl = tab.url.trim();
  if (trimmedUrl.length === 0) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    if (!/^https?:$/u.test(parsedUrl.protocol)) {
      return null;
    }

    const googleFaviconUrl = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(parsedUrl.origin)}`;
    return `https://corsproxy.io/?url=${encodeURIComponent(googleFaviconUrl)}`;
  } catch {
    return null;
  }
}

function TabFavicon({ tab }: { tab: RemoteBrowserTabEntry }) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [tab.id, tab.url]);

  const faviconUrl = getTabFaviconUrl(tab);

  if (!faviconUrl || hasError) {
    return (
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-white/[0.06] text-[7px] font-medium uppercase text-[#8b8e96]">
        {summarizeTab(tab).slice(0, 1) || "?"}
      </span>
    );
  }

  return (
    <img
      src={faviconUrl}
      alt=""
      onError={() => setHasError(true)}
      className="h-3.5 w-3.5 shrink-0 rounded-[3px] object-contain grayscale opacity-80"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

export function BrowserLivePreview({ profile, className, inactiveState, suppressLiveStatusUpdates = false, toolbar }: BrowserLivePreviewProps) {
  const openContextMenu = useInterfaceStore((state) => state.openContextMenu);
  const {
    canvasRef,
    previewViewportRef,
    tabStripRef,
    tabs,
    hasScreenshot,
    isLoading,
    isFullscreen,
    status,
    refreshTabs,
    refreshScreenshot,
    toggleFullscreen,
    handleTabSelect,
    closeTabs,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    handleCanvasPointerCancel,
    handleCanvasKeyDown,
  } = useBrowserLivePreviewController({
    profile,
    suppressLiveStatusUpdates,
  });

  function handleTabContextMenu(event: React.MouseEvent<HTMLButtonElement>, tab: RemoteBrowserTabEntry, tabIndex: number): void {
    event.preventDefault();
    event.stopPropagation();

    const tabsToRight = tabs.slice(tabIndex + 1);
    const otherTabs = tabs.filter((candidate) => candidate.id !== tab.id);

    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          id: `${profile.id}-${tab.id}-close`,
          label: "Close Tab",
          tone: "danger",
          disabled: tabs.length <= 1,
          onSelect: () => closeTabs([tab.id]),
        },
        {
          id: `${profile.id}-${tab.id}-close-others`,
          label: "Close Other Tabs",
          disabled: otherTabs.length === 0,
          onSelect: () => closeTabs(otherTabs.map((candidate) => candidate.id)),
        },
        {
          id: `${profile.id}-${tab.id}-close-right`,
          label: "Close Tabs to the Right",
          disabled: tabsToRight.length === 0,
          onSelect: () => closeTabs(tabsToRight.map((candidate) => candidate.id)),
        },
      ],
    });
  }

  const activeTab = tabs.find((tab) => tab.active) ?? null;
  const activeTitle = activeTab ? summarizeTab(activeTab) : (profile.currentUrl ?? profile.name);
  const activeFaviconUrl = activeTab ? getTabFaviconUrl(activeTab) : null;
  const toolbarContent = toolbar?.({
    activeTitle,
    activeFaviconUrl,
    status,
    isLoading,
    isFullscreen,
    canInteract: profile.isRunning,
    refresh: () => {
      void refreshScreenshot();
      void refreshTabs();
    },
    refreshTabs: () => {
      void refreshTabs();
    },
    toggleFullscreen: () => {
      void toggleFullscreen();
    },
  });

  return (
    <div className={joinClassNames("flex h-full flex-col gap-2", className)}>
      {!toolbarContent ? (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium text-white">{activeTitle}</p>
            <p className="truncate text-[10px] text-[#71717a]">{status}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => { void refreshTabs(); }}
              disabled={!profile.isRunning}
              className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white transition hover:bg-white/[0.12] disabled:opacity-50"
            >
              Tabs
            </button>
            <button
              type="button"
              onClick={() => { void refreshScreenshot(); void refreshTabs(); }}
              disabled={!profile.isRunning || isLoading}
              className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white transition hover:bg-white/[0.12] disabled:opacity-50"
            >
              {isLoading ? "Updating..." : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => { void toggleFullscreen(); }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.08] text-white transition hover:bg-white/[0.12]"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
              )}
            </button>
          </div>
        </div>
      ) : null}

      <div className={[
        "overflow-hidden rounded-[14px] bg-[#111112]",
        isFullscreen ? "h-screen w-screen rounded-none border-0 bg-[#050505]" : "",
      ].join(" ")}>
        {tabs.length > 0 ? (
          <div
            ref={tabStripRef}
            className="overflow-x-auto overflow-y-hidden bg-[#181818] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ overscrollBehaviorX: "contain", overscrollBehaviorY: "none" }}
          >
            <div className="flex min-w-max snap-x snap-mandatory items-end gap-1">
              {tabs.map((tab, tabIndex) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => { void handleTabSelect(tab.id); }}
                  onContextMenu={(event) => handleTabContextMenu(event, tab, tabIndex)}
                  className={[
                    "min-h-[34px] min-w-[108px] max-w-[216px] shrink-0 snap-start rounded-t-[11px] px-3.5 py-2 text-left text-[10px] transition",
                    tab.active
                      ? "bg-[#202021] text-white"
                      : "bg-[#151516] text-[#9b9ca1] hover:bg-[#1d1d1f] hover:text-white",
                  ].join(" ")}
                >
                  <span className="flex items-center gap-2">
                    <TabFavicon tab={tab} />
                    <span className="block truncate font-medium leading-tight">{summarizeTab(tab)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {toolbarContent ? (
          <div className="bg-[#1a1a1b] px-2.5 py-1.5">
            {toolbarContent}
          </div>
        ) : null}

        <div
          ref={previewViewportRef}
          className={[
            "relative overflow-auto bg-black p-0",
            isFullscreen ? "flex h-screen w-screen items-center justify-center overflow-auto bg-[#050505] p-0" : "",
          ].join(" ")}
          style={{ overscrollBehavior: profile.isRunning ? "contain" : "auto" }}
        >
          {profile.isRunning ? (
            <>
              <canvas
                ref={canvasRef}
                tabIndex={0}
                onPointerDown={(event) => { void handleCanvasPointerDown(event); }}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={(event) => { void handleCanvasPointerUp(event); }}
                onPointerCancel={(event) => { void handleCanvasPointerCancel(event); }}
                onKeyDown={(event) => { void handleCanvasKeyDown(event); }}
                className={[
                  "block cursor-crosshair touch-none outline-none",
                  hasScreenshot ? "opacity-100" : "pointer-events-none opacity-0",
                  isFullscreen
                    ? "mx-auto h-auto max-h-screen w-auto max-w-full"
                    : "w-full min-h-[420px]",
                ].join(" ")}
              />

              {!hasScreenshot ? (
                <div className="absolute inset-0 flex h-[420px] items-center justify-center text-[11px] text-[#6d6d78]">
                  {isLoading ? "Capturing screenshot..." : "No screenshot available."}
                </div>
              ) : null}
            </>
          ) : (
            inactiveState ?? (
              <div className="flex h-[420px] items-center justify-center text-[11px] text-[#6d6d78]">
                Launch the browser to enable live preview and click forwarding.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default function BrowserPreviewModal({ profile, onClose }: BrowserPreviewModalProps) {
  return (
    <Modal title={`${profile.name} Live Preview`} onClose={onClose}>
      <BrowserLivePreview profile={profile} />
    </Modal>
  );
}