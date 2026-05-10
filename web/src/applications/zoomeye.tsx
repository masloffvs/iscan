import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import {
  getRemoteZoomEyePassiveCaptureSession,
  listRemoteCloakBrowsers,
  pullRemoteZoomEyeSearch,
  startRemoteZoomEyePassiveCapture,
  stopRemoteZoomEyePassiveCapture,
  type RemoteBrowserProfileEntry,
  type RemoteZoomEyeHostEntry,
  type RemoteZoomEyePassiveCaptureEvent,
  type RemoteZoomEyePassiveCaptureSession,
  type RemoteZoomEyePullResult,
} from "../api/client";
import TableOutputRenderer from "../components/StructuredCellOutput/Renderers/TableOutputRenderer";
import type { PrimitiveTableEntity } from "../components/StructuredCellOutput/types";
import {
  ZoomEyeQueryEditor,
  ZOOMEYE_QUERY_QUICK_SNIPPETS,
} from "../components/ZoomEyeQueryEditor";
import workbookTheme from "../theme.tsx";
import {
  defineApplication,
  type ApplicationViewProps,
} from "./application";
import {
  ApplicationActionButton,
  ApplicationAlert,
  ApplicationEmptyState,
  ApplicationHeader,
  ApplicationMetaRow,
  ApplicationMetric,
  ApplicationPanel,
  ApplicationSurface,
} from "./application-layout.tsx";
import {
  ZOOMEYE_HOST_APPLICATION_ID,
  createZoomEyeHostInstanceTitle,
} from "./zoomeye-host";
import { useInterfaceStore } from "../store/ui";

export const ZOOMEYE_APPLICATION_ID = "applications/zoomeye";

const SEARCH_TYPE_OPTIONS = ["v4+v6+web", "web", "v4", "v6"] as const;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const MAX_RESULTS_OPTIONS = [25, 50, 100, 250] as const;

export type ZoomEyeInput = {
  query?: string | null;
  cloakProfileId?: string | null;
  searchType?: string | null;
  pageSize?: number | null;
  maxResults?: number | null;
  result?: RemoteZoomEyePullResult | null;
  captureSession?: RemoteZoomEyePassiveCaptureSession | null;
  error?: string | null;
};

function normalizeZoomEyeSearchType(value: string | null | undefined): string {
  return SEARCH_TYPE_OPTIONS.includes(value as typeof SEARCH_TYPE_OPTIONS[number])
    ? value as typeof SEARCH_TYPE_OPTIONS[number]
    : "v4+v6+web";
}

function normalizeZoomEyePageSize(value: number | null | undefined): number {
  return PAGE_SIZE_OPTIONS.includes(value as typeof PAGE_SIZE_OPTIONS[number])
    ? value as typeof PAGE_SIZE_OPTIONS[number]
    : 50;
}

function normalizeZoomEyeMaxResults(value: number | null | undefined): number {
  return MAX_RESULTS_OPTIONS.includes(value as typeof MAX_RESULTS_OPTIONS[number])
    ? value as typeof MAX_RESULTS_OPTIONS[number]
    : 100;
}

function getZoomEyeApplicationTitle(query: string): string {
  const trimmedQuery = query.trim();
  return trimmedQuery.length > 0
    ? `ZoomEye · ${trimmedQuery}`
    : "ZoomEye · live search";
}

function formatEndpoint(entry: RemoteZoomEyeHostEntry): string {
  return `${entry.ip}:${entry.port}`;
}

function formatService(entry: RemoteZoomEyeHostEntry): string {
  return [entry.service, entry.transport].filter((value): value is string => Boolean(value)).join("/") || "-";
}

function formatLocation(entry: RemoteZoomEyeHostEntry): string {
  return [entry.countryNameEn, entry.countryCode].filter((value): value is string => Boolean(value)).join(" · ") || "-";
}

function formatProfileOption(profile: RemoteBrowserProfileEntry): string {
  const parts = [profile.name];
  if (profile.headless) {
    parts.push("headless");
  }
  if (profile.isRunning) {
    parts.push("running");
  }
  return parts.join(" · ");
}

function formatPassiveCaptureQuery(event: RemoteZoomEyePassiveCaptureEvent): string {
  const queryText = event.queryText?.trim();
  return queryText && queryText.length > 0 ? queryText : event.queryBase64;
}

function createZoomEyeResultKey(entry: Pick<RemoteZoomEyeHostEntry, "ip" | "port">): string {
  return `${entry.ip}:${entry.port}`;
}

function createZoomEyeResultTableEntity(entries: readonly RemoteZoomEyeHostEntry[]): PrimitiveTableEntity {
  return {
    id: "zoomeye-results",
    createdAt: Date.now(),
    kind: "table",
    columns: [
      { key: "endpoint", header: "Endpoint", width: 18 },
      { key: "service", header: "Service", width: 16 },
      { key: "product", header: "Product", width: 18, maxWidth: 24 },
      { key: "hostname", header: "Hostname", width: 20, maxWidth: 26 },
      { key: "organization", header: "Org", width: 18, maxWidth: 24 },
      { key: "location", header: "Location", width: 16, maxWidth: 20 },
      { key: "title", header: "Title", width: 26, maxWidth: 34 },
      { key: "pulledAt", header: "Pulled", width: 22, maxWidth: 24 },
    ],
    rows: entries.map((entry) => ({
      endpoint: formatEndpoint(entry),
      service: formatService(entry),
      product: entry.product ?? "-",
      hostname: entry.hostname ?? "-",
      organization: entry.organization ?? "-",
      location: formatLocation(entry),
      title: entry.title ?? "-",
      pulledAt: entry.lastPulledAt,
    })),
    presentation: {
      kind: "ink-table",
      dense: true,
    },
  };
}

function createZoomEyeCaptureTableEntity(events: readonly RemoteZoomEyePassiveCaptureEvent[]): PrimitiveTableEntity {
  return {
    id: "zoomeye-passive-capture-events",
    createdAt: Date.now(),
    kind: "table",
    columns: [
      { key: "capturedAt", header: "Captured", width: 22 },
      { key: "query", header: "Query", width: 26, maxWidth: 36 },
      { key: "scope", header: "Scope", width: 18 },
      { key: "counts", header: "Counts", width: 12 },
      { key: "persisted", header: "Persisted", width: 12 },
      { key: "status", header: "Status", width: 28, maxWidth: 34 },
    ],
    rows: events.map((event) => ({
      capturedAt: event.capturedAt,
      query: formatPassiveCaptureQuery(event),
      scope: `${event.searchType} · p${event.page} · ${event.pageSize}`,
      counts: `${event.rawMatches}/${event.uniqueMatches}`,
      persisted: `+${event.inserted} · ~${event.updated}`,
      status: event.errorMessage ?? `${event.status} ${event.method.toUpperCase()} ${event.resourceType}`,
    })),
    presentation: {
      kind: "ink-table",
      dense: true,
    },
  };
}

function ActionButton({
  children,
  className,
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; className?: string }) {
  return (
    <ApplicationActionButton {...buttonProps} className={className}>
      {children}
    </ApplicationActionButton>
  );
}

function RefreshIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.3-3.36" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.75 2.75H13v2.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MetricTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className={`rounded-[14px] ${workbookTheme.surface.panel} px-3 py-3`}>
      <ApplicationMetric label={label} value={value} detail={detail} />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <ApplicationEmptyState text={text} />;
}

const selectClassName = `mt-2 w-full rounded-[12px] ${workbookTheme.surface.panel} px-3 py-2 text-[12px] ${workbookTheme.text.canvas} outline-none`;
const compactSelectClassName = `w-full rounded-[10px] ${workbookTheme.surface.panel} px-2.5 py-1.5 text-[11px] ${workbookTheme.text.canvas} outline-none`;
const fieldLabelClassName = `text-[9px] uppercase tracking-[0.16em] ${workbookTheme.text.labelSoft}`;

function ZoomEyeApp({
  instance,
  setTitle,
}: ApplicationViewProps<ZoomEyeInput>) {
  const openApplicationInstance = useInterfaceStore((state) => state.openApplicationInstance);
  const updateApplicationInstanceInput = useInterfaceStore((state) => state.updateApplicationInstanceInput);
  const [profiles, setProfiles] = useState<RemoteBrowserProfileEntry[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState(instance.input.cloakProfileId?.trim() ?? "");
  const [query, setQuery] = useState(instance.input.query?.trim() ?? "");
  const [searchType, setSearchType] = useState<string>(normalizeZoomEyeSearchType(instance.input.searchType));
  const [pageSize, setPageSize] = useState<number>(normalizeZoomEyePageSize(instance.input.pageSize));
  const [maxResults, setMaxResults] = useState<number>(normalizeZoomEyeMaxResults(instance.input.maxResults));
  const [result, setResult] = useState<RemoteZoomEyePullResult | null>(instance.input.result ?? null);
  const [captureSession, setCaptureSession] = useState<RemoteZoomEyePassiveCaptureSession | null>(instance.input.captureSession ?? null);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isCapturePending, setIsCapturePending] = useState(false);
  const [error, setError] = useState<string | null>(instance.input.error ?? null);
  const [selectedResultKey, setSelectedResultKey] = useState<string | null>(null);
  const [isPullControlsOpen, setIsPullControlsOpen] = useState(false);
  const pullControlsRef = useRef<HTMLDivElement | null>(null);

  const compatibleProfiles = useMemo(
    () => profiles.filter((profile) => profile.headless !== true),
    [profiles],
  );
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const isCaptureActive = captureSession?.active === true;
  const resultTableEntity = useMemo(
    () => createZoomEyeResultTableEntity(result?.entries ?? []),
    [result?.entries],
  );
  const captureTableEntity = useMemo(
    () => createZoomEyeCaptureTableEntity(captureSession?.recentEvents ?? []),
    [captureSession?.recentEvents],
  );
  const selectedResultRowIndex = useMemo(() => {
    if (!result || !selectedResultKey) {
      return null;
    }

    const rowIndex = result.entries.findIndex((entry) => createZoomEyeResultKey(entry) === selectedResultKey);
    return rowIndex >= 0 ? rowIndex : null;
  }, [result, selectedResultKey]);
  const selectedResultEntry = useMemo(() => {
    if (!result || !selectedResultKey) {
      return null;
    }

    return result.entries.find((entry) => createZoomEyeResultKey(entry) === selectedResultKey) ?? null;
  }, [result, selectedResultKey]);

  useEffect(() => {
    setTitle(getZoomEyeApplicationTitle(query));
  }, [query, setTitle]);

  useEffect(() => {
    updateApplicationInstanceInput(instance.instanceId, {
      query,
      cloakProfileId: selectedProfileId,
      searchType,
      pageSize,
      maxResults,
      result,
      captureSession,
      error,
    } satisfies ZoomEyeInput);
  }, [
    captureSession,
    error,
    instance.instanceId,
    maxResults,
    pageSize,
    query,
    result,
    searchType,
    selectedProfileId,
    updateApplicationInstanceInput,
  ]);

  useEffect(() => {
    let disposed = false;
    setIsLoadingProfiles(true);

    void listRemoteCloakBrowsers()
      .then((nextProfiles) => {
        if (disposed) {
          return;
        }

        setProfiles(nextProfiles);
      })
      .catch((loadError) => {
        if (disposed) {
          return;
        }

        setProfiles([]);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!disposed) {
          setIsLoadingProfiles(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (selectedProfileId || compatibleProfiles.length === 0) {
      return;
    }

    setSelectedProfileId(compatibleProfiles[0]!.id);
  }, [compatibleProfiles, selectedProfileId]);

  useEffect(() => {
    let disposed = false;
    const normalizedProfileId = selectedProfileId.trim();
    if (normalizedProfileId.length === 0) {
      setCaptureSession(null);
      return () => {
        disposed = true;
      };
    }

    void getRemoteZoomEyePassiveCaptureSession(normalizedProfileId)
      .then((session) => {
        if (!disposed) {
          setCaptureSession(session);
        }
      })
      .catch(() => {
        if (!disposed) {
          setCaptureSession(null);
        }
      });

    return () => {
      disposed = true;
    };
  }, [selectedProfileId]);

  useEffect(() => {
    const normalizedProfileId = selectedProfileId.trim();
    if (!captureSession?.active || normalizedProfileId.length === 0 || captureSession.cloakProfileId !== normalizedProfileId) {
      return;
    }

    let disposed = false;
    const timer = window.setTimeout(() => {
      void getRemoteZoomEyePassiveCaptureSession(normalizedProfileId)
        .then((session) => {
          if (!disposed) {
            setCaptureSession(session);
          }
        })
        .catch(() => {
          // Leave the last known session snapshot in place.
        });
    }, 2000);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [captureSession?.active, captureSession?.cloakProfileId, captureSession?.lastCapturedAt, selectedProfileId]);

  useEffect(() => {
    if (!result || result.entries.length === 0) {
      setSelectedResultKey(null);
      return;
    }

    if (!selectedResultKey || !result.entries.some((entry) => createZoomEyeResultKey(entry) === selectedResultKey)) {
      setSelectedResultKey(createZoomEyeResultKey(result.entries[0]!));
    }
  }, [result, selectedResultKey]);

  useEffect(() => {
    if (!isPullControlsOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (pullControlsRef.current?.contains(target)) {
        return;
      }

      setIsPullControlsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPullControlsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPullControlsOpen]);

  async function handleSearch(): Promise<void> {
    if (query.trim().length === 0) {
      setError("ZoomEye query is required.");
      return;
    }

    if (selectedProfileId.trim().length === 0) {
      setError("Choose a non-headless CloakBrowser profile first.");
      return;
    }

    setIsSearching(true);
    setError(null);
    try {
      const nextResult = await pullRemoteZoomEyeSearch({
        query: query.trim(),
        cloakProfileId: selectedProfileId,
        maxResults,
        pageSize,
        searchType,
        startPage: 1,
      });
      setResult(nextResult);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : String(searchError));
    } finally {
      setIsSearching(false);
    }
  }

  async function handleStartPassiveCapture(): Promise<void> {
    if (selectedProfileId.trim().length === 0) {
      setError("Choose a non-headless CloakBrowser profile first.");
      return;
    }

    setIsCapturePending(true);
    setError(null);
    try {
      const session = await startRemoteZoomEyePassiveCapture({
        cloakProfileId: selectedProfileId.trim(),
      });
      setCaptureSession(session);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally {
      setIsCapturePending(false);
    }
  }

  async function handleRefreshPassiveCapture(): Promise<void> {
    if (selectedProfileId.trim().length === 0) {
      setError("Choose a non-headless CloakBrowser profile first.");
      return;
    }

    setIsCapturePending(true);
    setError(null);
    try {
      const session = await getRemoteZoomEyePassiveCaptureSession(selectedProfileId.trim());
      setCaptureSession(session);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally {
      setIsCapturePending(false);
    }
  }

  async function handleStopPassiveCapture(): Promise<void> {
    if (selectedProfileId.trim().length === 0) {
      setError("Choose a non-headless CloakBrowser profile first.");
      return;
    }

    setIsCapturePending(true);
    setError(null);
    try {
      const session = await stopRemoteZoomEyePassiveCapture({
        cloakProfileId: selectedProfileId.trim(),
      });
      setCaptureSession(session);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally {
      setIsCapturePending(false);
    }
  }

  function openHostDetail(entry: RemoteZoomEyeHostEntry): void {
    const initialTitle = entry.title?.trim()
      ? `${entry.ip}:${entry.port} · ${entry.title}`
      : `${entry.ip}:${entry.port}`;

    openApplicationInstance({
      applicationId: ZOOMEYE_HOST_APPLICATION_ID,
      title: createZoomEyeHostInstanceTitle({
        ip: entry.ip,
        port: entry.port,
        initialTitle,
      }),
      input: {
        ip: entry.ip,
        port: entry.port,
        initialTitle,
      },
      select: false,
    });
  }

  function handleSelectResultRow(rowIndex: number): void {
    const entry = result?.entries[rowIndex];
    if (!entry) {
      return;
    }

    setSelectedResultKey(createZoomEyeResultKey(entry));
  }

  function handleActivateResultRow(rowIndex: number): void {
    const entry = result?.entries[rowIndex];
    if (!entry) {
      return;
    }

    setSelectedResultKey(createZoomEyeResultKey(entry));
    openHostDetail(entry);
  }

  return (
    <ApplicationSurface>
      <ApplicationHeader
        title="ZoomEye"
        subtitle="Live browser-backed search. Every result batch is persisted through the existing pull flow."
        meta={(
          <ApplicationMetaRow>
            <span>{selectedProfile ? selectedProfile.name : "No profile selected"}</span>
            <span>{searchType}</span>
            <span>{pageSize} / page</span>
            <span>{maxResults} max</span>
            <span>Capture {captureSession?.active ? "armed" : "idle"}</span>
          </ApplicationMetaRow>
        )}
        alert={error ? <ApplicationAlert>{error}</ApplicationAlert> : undefined}
        className="pb-1"
      />

      <div className="min-h-0 flex-1 space-y-4 pt-2">
        <div className="mx-auto w-full max-w-[1180px]">
          <ApplicationPanel
            title="Query Editor"
            subtitle="Field-aware query builder with snippets and keyboard shortcuts."
            className="relative z-10 overflow-visible"
            action={(
              <ActionButton onClick={() => { void handleSearch(); }} disabled={isSearching} className="px-3 py-2 font-medium uppercase tracking-[0.14em]">
                {isSearching ? "Searching..." : "Run live pull"}
              </ActionButton>
            )}
          >
            <div className="space-y-3">
              <div className="relative">
                <div className={`overflow-hidden rounded-[14px] ${workbookTheme.surface.panel} px-3 pb-9 pr-12 pt-2 text-[12px] ${workbookTheme.text.canvas}`}>
                  <ZoomEyeQueryEditor
                    value={query}
                    onChange={setQuery}
                    onRun={() => { void handleSearch(); }}
                  />
                </div>

                <div ref={pullControlsRef} className="absolute bottom-1.5 right-1.5 z-10">
                  <button
                    type="button"
                    aria-expanded={isPullControlsOpen}
                    aria-label="Pull controls"
                    onClick={() => setIsPullControlsOpen((current) => !current)}
                    className="rounded-[10px] bg-white/[0.05] px-2.5 py-1 text-[14px] leading-none text-[#d3d3d9] transition hover:bg-white/[0.1] hover:text-white"
                  >
                    ...
                  </button>

                  {isPullControlsOpen ? (
                    <div className="absolute right-0 top-full z-20 mt-2 w-[300px] max-w-[calc(100vw-32px)]">
                      <div className="pointer-events-auto sticky top-4 max-h-[min(420px,calc(100vh-160px))] self-start overflow-auto rounded-[10px] bg-[#101011]/92 p-1 shadow-[0_14px_34px_rgba(0,0,0,0.34)] backdrop-blur-sm">
                        <div className="grid grid-cols-1 gap-2">
                        <div>
                          <select
                            aria-label="Browser profile"
                            value={selectedProfileId}
                            onChange={(event) => setSelectedProfileId(event.target.value)}
                            className={compactSelectClassName}
                            disabled={isLoadingProfiles}
                          >
                            <option value="">{isLoadingProfiles ? "Loading profiles..." : "Choose profile"}</option>
                            {profiles.map((profile) => (
                              <option key={profile.id} value={profile.id} disabled={profile.headless === true}>
                                {formatProfileOption(profile)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <select
                            aria-label="Search type"
                            value={searchType}
                            onChange={(event) => setSearchType(event.target.value)}
                            className={compactSelectClassName}
                          >
                            {SEARCH_TYPE_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>

                          <select
                            aria-label="Page size"
                            value={pageSize}
                            onChange={(event) => setPageSize(Number(event.target.value))}
                            className={compactSelectClassName}
                          >
                            {PAGE_SIZE_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option} / page</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <select
                            aria-label="Max rows"
                            value={maxResults}
                            onChange={(event) => setMaxResults(Number(event.target.value))}
                            className={compactSelectClassName}
                          >
                            {MAX_RESULTS_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option} max</option>
                            ))}
                          </select>
                        </div>

                        <div className={`rounded-[12px] ${workbookTheme.surface.panelStrong} px-2.5 py-2.5`}>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (isCaptureActive) {
                                  void handleStopPassiveCapture();
                                  return;
                                }

                                void handleStartPassiveCapture();
                              }}
                              disabled={isCapturePending}
                              className={`min-w-0 flex-1 rounded-[10px] px-3 py-2 text-[10px] font-medium transition disabled:opacity-50 ${
                                isCaptureActive
                                  ? `${workbookTheme.surface.softAccent} ${workbookTheme.text.canvas} ${workbookTheme.interaction.hoverStrong}`
                                  : "bg-[#1f352a] text-[#d8f8e3] hover:bg-[#284533]"
                              }`}
                            >
                              {isCaptureActive ? "Stop capture" : "Start capture"}
                            </button>

                            {isCaptureActive ? (
                              <button
                                type="button"
                                aria-label="Refresh capture session"
                                onClick={() => { void handleRefreshPassiveCapture(); }}
                                disabled={isCapturePending || selectedProfileId.trim().length === 0}
                                className={`flex h-8 w-8 items-center justify-center rounded-[10px] ${workbookTheme.surface.softAccent} ${workbookTheme.text.canvas} transition ${workbookTheme.interaction.hoverStrong} disabled:opacity-50`}
                              >
                                <RefreshIcon />
                              </button>
                            ) : null}
                          </div>

                          <p className={`mt-2 text-[10px] ${workbookTheme.text.secondary}`}>
                            Profiles {compatibleProfiles.length} · Capture {isCaptureActive ? "armed" : "idle"}
                            {captureSession ? ` · ${captureSession.totalCaptured} event${captureSession.totalCaptured === 1 ? "" : "s"}` : ""}
                            {captureSession?.profileRunning === false ? " · browser stopped" : ""}
                          </p>
                        </div>
                      </div>
                    </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                {ZOOMEYE_QUERY_QUICK_SNIPPETS.map((snippet) => (
                  <button
                    key={snippet.label}
                    type="button"
                    onClick={() => setQuery(snippet.query)}
                    className={`rounded-[10px] ${workbookTheme.surface.softAccent} px-3 py-1.5 text-[10px] font-medium ${workbookTheme.text.bodySoft} transition ${workbookTheme.interaction.hoverStrong}`}
                  >
                    {snippet.label}
                  </button>
                ))}
              </div>
            </div>
          </ApplicationPanel>
        </div>

        <div className="mx-auto w-full max-w-[1180px] space-y-4">
          <ApplicationPanel
            title="Search Results"
            subtitle="Persisted host rows from the latest authenticated pull."
            action={(
              <ActionButton
                onClick={() => {
                  if (selectedResultEntry) {
                    openHostDetail(selectedResultEntry);
                  }
                }}
                disabled={!selectedResultEntry}
                className="px-3 py-2"
              >
                Open host
              </ActionButton>
            )}
          >
            {result ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricTile label="Rows" value={`${result.entries.length}`} />
                  <MetricTile label="Fetched" value={result.fetchedAt} />
                  <MetricTile label="Profile" value={selectedProfile?.name ?? "unknown"} />
                  <MetricTile label="Scope" value={`${searchType} · ${pageSize}/page`} />
                </div>

                <div className={`rounded-[14px] ${workbookTheme.surface.panelStrong} p-3`}>
                  <p className={fieldLabelClassName}>Query</p>
                  <p className={`mt-2 whitespace-pre-wrap break-words text-[12px] leading-relaxed ${workbookTheme.text.body}`}>
                    {result.queryText ?? result.queryBase64}
                  </p>
                </div>

                {result.entries.length > 0 ? (
                  <div className="space-y-3">
                    <p className={`text-[10px] ${workbookTheme.text.secondary}`}>
                      Single click selects a host. Double click or Enter opens the host detail application.
                    </p>
                    <TableOutputRenderer
                      entity={resultTableEntity}
                      selectedRowIndex={selectedResultRowIndex}
                      onRowSelect={(rowIndex) => handleSelectResultRow(rowIndex)}
                      onRowActivate={(rowIndex) => handleActivateResultRow(rowIndex)}
                    />
                  </div>
                ) : (
                  <EmptyState text="ZoomEye returned no persisted rows for this pull." />
                )}
              </div>
            ) : (
              <EmptyState text="Run a live ZoomEye search to fill the table with the freshly persisted batch." />
            )}
          </ApplicationPanel>

          <ApplicationPanel title="Passive Capture" subtitle="User-driven ZoomEye search traffic captured from the selected CloakBrowser profile.">
            {captureSession ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricTile label="Profile" value={captureSession.cloakProfileLabel} />
                  <MetricTile label="Status" value={captureSession.active ? "armed" : "stopped"} />
                  <MetricTile label="Events" value={`${captureSession.totalCaptured}`} />
                  <MetricTile label="Last Event" value={captureSession.lastCapturedAt ?? "waiting"} />
                </div>

                {captureSession.currentUrl ? (
                  <div className={`rounded-[14px] ${workbookTheme.surface.panelStrong} p-3`}>
                    <p className={fieldLabelClassName}>Current URL</p>
                    <p className={`mt-2 break-all text-[11px] ${workbookTheme.text.body}`}>{captureSession.currentUrl}</p>
                  </div>
                ) : null}

                {captureSession.recentEvents.length > 0 ? (
                  <TableOutputRenderer entity={captureTableEntity} />
                ) : (
                  <EmptyState text="No manual ZoomEye search responses have been captured for this profile yet." />
                )}
              </div>
            ) : (
              <EmptyState text="Choose a compatible CloakBrowser profile to inspect or arm passive capture." />
            )}
          </ApplicationPanel>
        </div>
      </div>
    </ApplicationSurface>
  );
}

export const zoomeyeApplication = defineApplication<ZoomEyeInput>({
  id: ZOOMEYE_APPLICATION_ID,
  title: "ZoomEye",
  View: ZoomEyeApp,
  getInitialTitle: (input) => getZoomEyeApplicationTitle(input.query ?? ""),
});