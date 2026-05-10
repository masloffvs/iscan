import { useEffect, useMemo, useState } from "react";

import {
  type RemoteAuditCrawlEdge,
  listRemoteCloakBrowsers,
  runRemoteAuditCrawl,
  type RemoteAuditCrawlFetchMode,
  type RemoteAuditCrawlFinding,
  type RemoteAuditCrawlResourceKind,
  type RemoteAuditCrawlResourceNode,
  type RemoteAuditCrawlResult,
  type RemoteBrowserProfileEntry,
} from "../api/client";
import {
  defineApplication,
  type ApplicationViewProps,
} from "./application";
import { useInterfaceStore } from "../store/ui";

export const CRAWL_AUDIT_APPLICATION_ID = "applications/crawl-audit";

const FETCH_MODE_OPTIONS = ["browser", "http"] as const satisfies readonly RemoteAuditCrawlFetchMode[];
const TYPE_FILTER_OPTIONS = [
  "all",
  "document",
  "script",
  "style",
  "modulepreload",
  "fetch",
  "xhr",
  "source-map",
  "source-file",
  "other",
] as const;

type ResourceFilterMode = "all" | "with-findings" | "with-sourcemap" | "external" | "dynamic";
type FindingScopeMode = "selected" | "all";
type FindingSeverityFilter = "all" | "high" | "medium" | "low";
type CrawlAuditWorkspaceTab = "search" | "resources" | "dependencies" | "leakage";

type CrawlAuditDependencyTreeNode = {
  id: string;
  label: string;
  meta?: string;
  resourceId?: string;
  isBranch?: boolean;
  children?: CrawlAuditDependencyTreeNode[];
};

export type CrawlAuditInput = {
  url?: string | null;
  cloakProfileId?: string | null;
  fetchMode?: RemoteAuditCrawlFetchMode | null;
  maxAssets?: number | null;
  timeoutMs?: number | null;
  renderMs?: number | null;
  sameOriginOnly?: boolean | null;
  result?: RemoteAuditCrawlResult | null;
  error?: string | null;
};

function getCrawlAuditTitle(url: string): string {
  const trimmedUrl = url.trim();
  return trimmedUrl.length > 0
    ? `Crawl Auditor · ${trimmedUrl}`
    : "Crawl Auditor · resource map";
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

function formatBytes(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "-";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function countFindingsByResource(findings: readonly RemoteAuditCrawlFinding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    if (!finding.resourceId) {
      continue;
    }

    counts.set(finding.resourceId, (counts.get(finding.resourceId) ?? 0) + 1);
  }

  return counts;
}

function matchesResourceFilter(
  resource: RemoteAuditCrawlResourceNode,
  findingCounts: Map<string, number>,
  resourceFilterMode: ResourceFilterMode,
): boolean {
  switch (resourceFilterMode) {
    case "with-findings":
      return (findingCounts.get(resource.id) ?? 0) > 0;
    case "with-sourcemap":
      return resource.hasSourceMap;
    case "external":
      return !resource.sameOrigin;
    case "dynamic":
      return resource.isDynamic;
    default:
      return true;
  }
}

function formatResourceScope(resource: RemoteAuditCrawlResourceNode): string {
  return resource.sameOrigin ? "same-origin" : "external";
}

function formatResourceFlags(resource: RemoteAuditCrawlResourceNode, findingCount: number): string {
  const parts = [
    resource.isDynamic ? "dynamic" : null,
    !resource.sameOrigin ? "external" : null,
    resource.hasSourceMap ? "sourcemap" : null,
    findingCount > 0 ? `${findingCount} finding${findingCount === 1 ? "" : "s"}` : null,
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" · ") : "-";
}

function buildDependencyTree(
  selectedResource: RemoteAuditCrawlResourceNode,
  outgoingEdges: readonly RemoteAuditCrawlEdge[],
  incomingEdges: readonly RemoteAuditCrawlEdge[],
  resourcesById: Map<string, RemoteAuditCrawlResourceNode>,
): CrawlAuditDependencyTreeNode[] {
  const mapEdgeNode = (edge: RemoteAuditCrawlEdge, direction: "out" | "in"): CrawlAuditDependencyTreeNode => {
    const relatedId = direction === "out" ? edge.to : edge.from;
    const relatedResource = resourcesById.get(relatedId);

    return {
      id: `${direction}:${selectedResource.id}:${relatedId}:${edge.kind}`,
      label: relatedResource?.label ?? relatedId,
      meta: [relatedResource?.kind ?? "resource", edge.kind, edge.note].filter((value): value is string => Boolean(value)).join(" · "),
      resourceId: relatedResource?.id,
    };
  };

  return [
    {
      id: `selected:${selectedResource.id}`,
      label: selectedResource.label,
      meta: [selectedResource.kind, selectedResource.status, selectedResource.discoveredBy].join(" · "),
      resourceId: selectedResource.id,
      children: [
        {
          id: `branch:out:${selectedResource.id}`,
          label: `Outgoing (${outgoingEdges.length})`,
          isBranch: true,
          children: outgoingEdges.length > 0
            ? outgoingEdges.map((edge) => mapEdgeNode(edge, "out"))
            : [{
              id: `branch:out:empty:${selectedResource.id}`,
              label: "No outgoing dependencies captured.",
              isBranch: true,
            }],
        },
        {
          id: `branch:in:${selectedResource.id}`,
          label: `Incoming (${incomingEdges.length})`,
          isBranch: true,
          children: incomingEdges.length > 0
            ? incomingEdges.map((edge) => mapEdgeNode(edge, "in"))
            : [{
              id: `branch:in:empty:${selectedResource.id}`,
              label: "No upstream dependencies captured.",
              isBranch: true,
            }],
        },
      ],
    },
  ];
}

function DependencyTreeNodes({
  nodes,
  selectedResourceId,
  onSelectResource,
  depth = 0,
}: {
  nodes: readonly CrawlAuditDependencyTreeNode[];
  selectedResourceId: string | null;
  onSelectResource: (resourceId: string) => void;
  depth?: number;
}) {
  return (
    <ul className={depth === 0 ? "space-y-1" : "mt-1 space-y-1 pl-4"}>
      {nodes.map((node) => (
        <li key={node.id}>
          {node.resourceId ? (
            <button
              type="button"
              onClick={() => onSelectResource(node.resourceId!)}
              className={`flex w-full items-start gap-2 rounded-[10px] px-2 py-1.5 text-left transition ${selectedResourceId === node.resourceId ? "bg-white/[0.08] text-white" : "text-[#d8d8df] hover:bg-white/[0.04]"}`}
            >
              <span className="mt-[2px] text-[9px] text-[#7d7d86]">▸</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium">{node.label}</span>
                {node.meta ? (
                  <span className={`mt-0.5 block truncate text-[10px] ${selectedResourceId === node.resourceId ? "text-[#cfcfd6]" : "text-[#8f9098]"}`}>
                    {node.meta}
                  </span>
                ) : null}
              </span>
            </button>
          ) : (
            <div className="px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[#7d7d86]">
              {node.label}
            </div>
          )}
          {node.children && node.children.length > 0 ? (
            <DependencyTreeNodes
              nodes={node.children}
              selectedResourceId={selectedResourceId}
              onSelectResource={onSelectResource}
              depth={depth + 1}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CrawlAuditApp({
  instance,
  setTitle,
}: ApplicationViewProps<CrawlAuditInput>) {
  const updateApplicationInstanceInput = useInterfaceStore((state) => state.updateApplicationInstanceInput);
  const [profiles, setProfiles] = useState<RemoteBrowserProfileEntry[]>([]);
  const [url, setUrl] = useState(instance.input.url?.trim() ?? "");
  const [fetchMode, setFetchMode] = useState<RemoteAuditCrawlFetchMode>(instance.input.fetchMode ?? "browser");
  const [selectedProfileId, setSelectedProfileId] = useState(instance.input.cloakProfileId?.trim() ?? "");
  const [maxAssets, setMaxAssets] = useState<number>(instance.input.maxAssets ?? 20);
  const [timeoutMs, setTimeoutMs] = useState<number>(instance.input.timeoutMs ?? 15000);
  const [renderMs, setRenderMs] = useState<number>(instance.input.renderMs ?? 1200);
  const [sameOriginOnly, setSameOriginOnly] = useState(instance.input.sameOriginOnly ?? true);
  const [result, setResult] = useState<RemoteAuditCrawlResult | null>(instance.input.result ?? null);
  const [error, setError] = useState<string | null>(instance.input.error ?? null);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<CrawlAuditWorkspaceTab>(instance.input.result ? "resources" : "search");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTER_OPTIONS)[number]>("all");
  const [resourceFilterMode, setResourceFilterMode] = useState<ResourceFilterMode>("all");
  const [findingScope, setFindingScope] = useState<FindingScopeMode>("selected");
  const [findingSeverity, setFindingSeverity] = useState<FindingSeverityFilter>("all");
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(instance.input.result?.entryResourceId ?? null);

  const compatibleProfiles = useMemo(
    () => profiles.filter((profile) => profile.headless !== true),
    [profiles],
  );
  const hasSelectedCompatibleProfile = useMemo(
    () => compatibleProfiles.some((profile) => profile.id === selectedProfileId),
    [compatibleProfiles, selectedProfileId],
  );

  useEffect(() => {
    setTitle(getCrawlAuditTitle(url));
  }, [setTitle, url]);

  useEffect(() => {
    updateApplicationInstanceInput(instance.instanceId, {
      url,
      cloakProfileId: selectedProfileId,
      fetchMode,
      maxAssets,
      timeoutMs,
      renderMs,
      sameOriginOnly,
      result,
      error,
    } satisfies CrawlAuditInput);
  }, [
    error,
    fetchMode,
    instance.instanceId,
    maxAssets,
    renderMs,
    result,
    sameOriginOnly,
    selectedProfileId,
    timeoutMs,
    updateApplicationInstanceInput,
    url,
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
    if (fetchMode !== "browser" || selectedProfileId || compatibleProfiles.length === 0) {
      return;
    }

    setSelectedProfileId(compatibleProfiles[0]!.id);
  }, [compatibleProfiles, fetchMode, selectedProfileId]);

  useEffect(() => {
    if (fetchMode !== "browser" || selectedProfileId.length === 0 || hasSelectedCompatibleProfile) {
      return;
    }

    setSelectedProfileId(compatibleProfiles[0]?.id ?? "");
  }, [compatibleProfiles, fetchMode, hasSelectedCompatibleProfile, selectedProfileId]);

  useEffect(() => {
    if (!result) {
      setSelectedResourceId(null);
      return;
    }

    const hasSelectedResource = selectedResourceId
      ? result.resources.some((resource) => resource.id === selectedResourceId)
      : false;
    if (!hasSelectedResource) {
      setSelectedResourceId(result.entryResourceId);
    }
  }, [result, selectedResourceId]);

  const findingCountsByResource = useMemo(
    () => countFindingsByResource(result?.findings ?? []),
    [result?.findings],
  );

  const filteredResources = useMemo(() => {
    if (!result) {
      return [];
    }

    const normalizedSearch = searchQuery.trim().toLowerCase();
    return result.resources.filter((resource) => {
      if (typeFilter !== "all" && resource.kind !== typeFilter) {
        return false;
      }

      if (!matchesResourceFilter(resource, findingCountsByResource, resourceFilterMode)) {
        return false;
      }

      if (normalizedSearch.length === 0) {
        return true;
      }

      const haystack = [resource.label, resource.url, resource.contentType, resource.note]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("\n")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [findingCountsByResource, resourceFilterMode, result, searchQuery, typeFilter]);

  const resourcesById = useMemo(
    () => new Map((result?.resources ?? []).map((resource) => [resource.id, resource])),
    [result?.resources],
  );

  const selectedResource = selectedResourceId
    ? resourcesById.get(selectedResourceId) ?? null
    : null;

  const outgoingEdges = useMemo(() => {
    if (!result || !selectedResourceId) {
      return [];
    }

    return result.edges.filter((edge) => edge.from === selectedResourceId);
  }, [result, selectedResourceId]);

  const incomingEdges = useMemo(() => {
    if (!result || !selectedResourceId) {
      return [];
    }

    return result.edges.filter((edge) => edge.to === selectedResourceId);
  }, [result, selectedResourceId]);

  const visibleFindings = useMemo(() => {
    const findings = result?.findings ?? [];
    return findings.filter((finding) => {
      if (findingSeverity !== "all" && finding.severity !== findingSeverity) {
        return false;
      }

      if (findingScope === "selected" && selectedResourceId) {
        return finding.resourceId === selectedResourceId;
      }

      return true;
    });
  }, [findingScope, findingSeverity, result?.findings, selectedResourceId]);

  const selectedResourceFindingCount = selectedResource
    ? findingCountsByResource.get(selectedResource.id) ?? 0
    : 0;

  const dependencyTree = useMemo(() => {
    if (!selectedResource) {
      return [];
    }

    return buildDependencyTree(selectedResource, outgoingEdges, incomingEdges, resourcesById);
  }, [incomingEdges, outgoingEdges, resourcesById, selectedResource]);

  async function handleRunAudit(): Promise<void> {
    if (url.trim().length === 0) {
      setError("Entry URL is required.");
      return;
    }

    if (fetchMode === "browser" && selectedProfileId.trim().length === 0) {
      setError("Choose a non-headless CloakBrowser profile or switch to HTTP mode.");
      return;
    }

    if (fetchMode === "browser" && !hasSelectedCompatibleProfile) {
      setError("Selected browser profile is no longer available. Pick one from the list and rerun the audit.");
      return;
    }

    setIsRunning(true);
    setError(null);
    try {
      const nextResult = await runRemoteAuditCrawl({
        url: url.trim(),
        fetchMode,
        cloakProfileId: fetchMode === "browser" ? selectedProfileId : undefined,
        maxAssets,
        timeoutMs,
        renderMs: fetchMode === "browser" ? renderMs : 0,
        sameOriginOnly,
      });

      setResult(nextResult);
      setSelectedResourceId(nextResult.entryResourceId);
      setActiveTab("resources");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#121212] text-white">
      <div className="px-4 pt-3">
        <div className="flex items-center gap-1 rounded-[12px] bg-black/20 p-1">
          {([
            ["search", "Search"],
            ["resources", "Resources"],
            ["dependencies", "Dependencies"],
            ["leakage", "Leakage"],
          ] as const).map(([tabId, label]) => (
            <button
              key={tabId}
              type="button"
              onClick={() => setActiveTab(tabId)}
              className={`rounded-[9px] px-3 py-1.5 text-[10px] font-medium transition ${activeTab === tabId ? "bg-white/[0.08] text-white" : "text-[#8d8d96] hover:bg-white/[0.04] hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 py-3">
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#7d7d86]">Runtime resource graph</p>
            <h2 className="mt-1 truncate text-[14px] font-semibold text-[#ececf2]">{getCrawlAuditTitle(url)}</h2>
            <p className="mt-1 max-w-[720px] text-[10px] leading-relaxed text-[#8e8e97]">Maps the entry document, discovered chunks, dynamic requests and sourcemap-linked source files, then overlays leakage findings on top of that graph.</p>
          </div>

          {activeTab !== "search" && selectedResource ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#8d8d96]">
              <span className="text-[#ececf2]">Selected: {selectedResource.label}</span>
              <span>{selectedResource.kind}</span>
              <span>{selectedResource.status}</span>
              <span>{formatResourceScope(selectedResource)}</span>
              <span>{formatResourceFlags(selectedResource, selectedResourceFindingCount)}</span>
            </div>
          ) : null}

          <div className="mt-3 min-h-0 flex-1 rounded-[18px] bg-black/20 px-3 py-3">
            {activeTab === "search" ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-[#7d7d86]">Search</p>
                    <p className="mt-1 text-[10px] text-[#9a9aa4]">Configure the crawl and launch a fresh resource graph scan.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void handleRunAudit(); }}
                    disabled={isRunning}
                    className="rounded-[12px] bg-[#f3f3f6] px-3.5 py-2 text-[10px] font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:bg-white/30"
                  >
                    {isRunning ? "Auditing..." : "Run crawl audit"}
                  </button>
                </div>

                <div className="mt-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
                  <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-[minmax(0,1.7fr)_minmax(210px,0.82fr)_minmax(210px,0.82fr)]">
                    <label className="flex min-w-0 flex-col gap-1.5">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-[#7d7d86]">Entry URL</span>
                      <input
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder="https://jetsai.ru/"
                        className="w-full rounded-[14px] bg-white/[0.05] px-3.5 py-2.5 text-[11px] text-white outline-none ring-1 ring-white/6 transition placeholder:text-[#777781] focus:bg-white/[0.08] focus:ring-white/14"
                      />
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-[#7d7d86]">Fetch mode</span>
                      <select
                        value={fetchMode}
                        onChange={(event) => setFetchMode(event.target.value as RemoteAuditCrawlFetchMode)}
                        className="rounded-[14px] bg-white/[0.05] px-3.5 py-2.5 text-[11px] text-white outline-none ring-1 ring-white/6 transition focus:bg-white/[0.08] focus:ring-white/14"
                      >
                        {FETCH_MODE_OPTIONS.map((option) => (
                          <option key={option} value={option} className="bg-[#121212] text-white">
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-[#7d7d86]">Browser profile</span>
                      <select
                        value={selectedProfileId}
                        onChange={(event) => setSelectedProfileId(event.target.value)}
                        disabled={fetchMode !== "browser" || isLoadingProfiles}
                        className="rounded-[14px] bg-white/[0.05] px-3.5 py-2.5 text-[11px] text-white outline-none ring-1 ring-white/6 transition disabled:opacity-45 focus:bg-white/[0.08] focus:ring-white/14"
                      >
                        <option value="" className="bg-[#121212] text-white">{isLoadingProfiles ? "Loading profiles..." : "Select profile"}</option>
                        {compatibleProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id} className="bg-[#121212] text-white">
                            {formatProfileOption(profile)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2.5 xl:grid-cols-[120px_120px_120px_minmax(0,1fr)]">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-[#7d7d86]">Max assets</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={maxAssets}
                        onChange={(event) => setMaxAssets(Math.max(1, Number(event.target.value) || 1))}
                        className="rounded-[14px] bg-white/[0.05] px-3.5 py-2.5 text-[11px] text-white outline-none ring-1 ring-white/6 transition focus:bg-white/[0.08] focus:ring-white/14"
                      />
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-[#7d7d86]">Timeout</span>
                      <input
                        type="number"
                        min={1000}
                        step={500}
                        value={timeoutMs}
                        onChange={(event) => setTimeoutMs(Math.max(1000, Number(event.target.value) || 1000))}
                        className="rounded-[14px] bg-white/[0.05] px-3.5 py-2.5 text-[11px] text-white outline-none ring-1 ring-white/6 transition focus:bg-white/[0.08] focus:ring-white/14"
                      />
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-[#7d7d86]">Render wait</span>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={renderMs}
                        onChange={(event) => setRenderMs(Math.max(0, Number(event.target.value) || 0))}
                        disabled={fetchMode !== "browser"}
                        className="rounded-[14px] bg-white/[0.05] px-3.5 py-2.5 text-[11px] text-white outline-none ring-1 ring-white/6 transition disabled:opacity-45 focus:bg-white/[0.08] focus:ring-white/14"
                      />
                    </label>

                    <label className="flex items-center gap-2.5 rounded-[14px] bg-white/[0.04] px-3.5 py-2.5 text-[10px] text-[#dfdfe5] ring-1 ring-white/5">
                      <input
                        type="checkbox"
                        checked={sameOriginOnly}
                        onChange={(event) => setSameOriginOnly(event.target.checked)}
                        className="size-4 rounded bg-white/[0.08] accent-white"
                      />
                      Restrict deep content scanning to same-origin resources
                    </label>
                  </div>

                  {error ? (
                    <div className="mt-2.5 rounded-[14px] bg-rose-500/12 px-3.5 py-2.5 text-[10px] text-rose-100 ring-1 ring-rose-300/10">
                      {error}
                    </div>
                  ) : null}
                </div>

                {result ? (
                  <div className="mt-3 rounded-[16px] bg-white/[0.03] px-3 py-3 text-[10px] text-[#8f9098]">
                    Last crawl is ready. Open Resources, Dependencies, or Leakage to inspect the current graph.
                  </div>
                ) : (
                  <div className="mt-3 flex min-h-0 flex-1 items-center justify-center text-center text-[11px] text-[#8d8d96]">
                    Run a crawl audit to build the resource map, detect sourcemap-linked source files and overlay leakage findings on top of the runtime graph.
                  </div>
                )}
              </div>
            ) : !result ? (
              <div className="flex h-full items-center justify-center rounded-[18px] px-5 text-center text-[11px] text-[#8d8d96]">
                No crawl result yet. Open the Search tab and run an audit first.
              </div>
            ) : activeTab === "resources" ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-[#7d7d86]">Resources</p>
                      <p className="mt-1 text-[10px] text-[#9a9aa4]">Compact table for selecting the node you want to inspect next.</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Filter URL or MIME"
                        className="rounded-[12px] bg-white/[0.05] px-3 py-2 text-[10px] text-white outline-none ring-1 ring-white/6 transition placeholder:text-[#777781] focus:bg-white/[0.08] focus:ring-white/14"
                      />
                      <select
                        value={typeFilter}
                        onChange={(event) => setTypeFilter(event.target.value as (typeof TYPE_FILTER_OPTIONS)[number])}
                        className="rounded-[12px] bg-white/[0.05] px-3 py-2 text-[10px] text-white outline-none ring-1 ring-white/6 transition focus:bg-white/[0.08] focus:ring-white/14"
                      >
                        {TYPE_FILTER_OPTIONS.map((option) => (
                          <option key={option} value={option} className="bg-[#121212] text-white">
                            {option}
                          </option>
                        ))}
                      </select>
                      <select
                        value={resourceFilterMode}
                        onChange={(event) => setResourceFilterMode(event.target.value as ResourceFilterMode)}
                        className="rounded-[12px] bg-white/[0.05] px-3 py-2 text-[10px] text-white outline-none ring-1 ring-white/6 transition focus:bg-white/[0.08] focus:ring-white/14"
                      >
                        <option value="all" className="bg-[#121212] text-white">all resources</option>
                        <option value="with-findings" className="bg-[#121212] text-white">with findings</option>
                        <option value="with-sourcemap" className="bg-[#121212] text-white">with sourcemap</option>
                        <option value="external" className="bg-[#121212] text-white">external only</option>
                        <option value="dynamic" className="bg-[#121212] text-white">dynamic only</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-3 min-h-0 flex-1 overflow-auto">
                    {filteredResources.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-[10px] text-[#8d8d96]">
                        No resources match the current filters.
                      </div>
                    ) : (
                      <table className="w-full min-w-[980px] table-fixed border-collapse">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[#7d7d86]">
                            <th className="pb-2 pr-3 font-medium">Kind</th>
                            <th className="pb-2 pr-3 font-medium">Node</th>
                            <th className="pb-2 pr-3 font-medium">Status</th>
                            <th className="pb-2 pr-3 font-medium">Scope</th>
                            <th className="pb-2 pr-3 font-medium">Flags</th>
                            <th className="pb-2 pr-3 font-medium">Payload</th>
                            <th className="pb-2 font-medium">URL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredResources.map((resource) => {
                            const findingCount = findingCountsByResource.get(resource.id) ?? 0;
                            const isSelected = resource.id === selectedResourceId;

                            return (
                              <tr
                                key={resource.id}
                                onClick={() => {
                                  setSelectedResourceId(resource.id);
                                  setActiveTab("dependencies");
                                }}
                                className={`cursor-pointer align-top text-[11px] transition ${isSelected ? "bg-white/[0.08] text-white" : "text-[#d2d2d8] hover:bg-white/[0.04]"}`}
                              >
                                <td className="px-2 py-2 pr-3 text-[10px] text-[#a6a6af]">{resource.kind}</td>
                                <td className="px-2 py-2 pr-3">
                                  <div className="font-medium">{resource.label}</div>
                                  <div className="mt-0.5 text-[10px] text-[#8f9098]">{resource.discoveredBy}</div>
                                </td>
                                <td className="px-2 py-2 pr-3 text-[10px]">{resource.status}</td>
                                <td className="px-2 py-2 pr-3 text-[10px]">{formatResourceScope(resource)}</td>
                                <td className="px-2 py-2 pr-3 text-[10px] text-[#bfc0c8]">{formatResourceFlags(resource, findingCount)}</td>
                                <td className="px-2 py-2 pr-3 text-[10px]">{formatBytes(resource.bytes)}</td>
                                <td className="px-2 py-2 text-[10px] text-[#8f9098]">{resource.url}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
            ) : activeTab === "dependencies" ? (
                selectedResource ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="flex flex-wrap items-start justify-between gap-2.5">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-[#7d7d86]">Dependencies</p>
                        <h3 className="mt-1 break-all text-[13px] font-semibold text-[#f2f2f6]">{selectedResource.label}</h3>
                        <p className="mt-1 break-all text-[10px] text-[#8f9098]">{selectedResource.url}</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-[10px] text-[#d8d8df]">
                        <span className="rounded-full bg-white/[0.05] px-2.5 py-1">{selectedResource.kind}</span>
                        <span className="rounded-full bg-white/[0.05] px-2.5 py-1">{selectedResource.status}</span>
                        <span className="rounded-full bg-white/[0.05] px-2.5 py-1">outgoing {outgoingEdges.length}</span>
                        <span className="rounded-full bg-white/[0.05] px-2.5 py-1">incoming {incomingEdges.length}</span>
                        <span className="rounded-full bg-white/[0.05] px-2.5 py-1">findings {selectedResourceFindingCount}</span>
                      </div>
                    </div>

                    <div className="mt-3 rounded-[12px] bg-white/[0.03] px-3 py-2.5 text-[10px] text-[#8f9098]">
                      <span>{selectedResource.contentType ?? "unknown content type"}</span>
                      {selectedResource.initiatorUrl ? <span> · initiator {selectedResource.initiatorUrl}</span> : null}
                      {selectedResource.parentUrl ? <span> · parent {selectedResource.parentUrl}</span> : null}
                      {selectedResource.note ? <span> · {selectedResource.note}</span> : null}
                    </div>

                    <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
                      <DependencyTreeNodes
                        nodes={dependencyTree}
                        selectedResourceId={selectedResourceId}
                        onSelectResource={setSelectedResourceId}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-[#8d8d96]">
                    Pick a resource from the Resources or Leakage tab to inspect its dependency tree.
                  </div>
                )
            ) : (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-[#7d7d86]">Leakage</p>
                      <p className="mt-1 text-[10px] text-[#9a9aa4]">Simple findings table linked back to the selected runtime resource when possible.</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <select
                        value={findingScope}
                        onChange={(event) => setFindingScope(event.target.value as FindingScopeMode)}
                        className="rounded-[12px] bg-white/[0.05] px-3 py-2 text-[10px] text-white outline-none ring-1 ring-white/6 transition focus:bg-white/[0.08] focus:ring-white/14"
                      >
                        <option value="selected" className="bg-[#121212] text-white">selected node</option>
                        <option value="all" className="bg-[#121212] text-white">whole graph</option>
                      </select>
                      <select
                        value={findingSeverity}
                        onChange={(event) => setFindingSeverity(event.target.value as FindingSeverityFilter)}
                        className="rounded-[12px] bg-white/[0.05] px-3 py-2 text-[10px] text-white outline-none ring-1 ring-white/6 transition focus:bg-white/[0.08] focus:ring-white/14"
                      >
                        <option value="all" className="bg-[#121212] text-white">all severities</option>
                        <option value="high" className="bg-[#121212] text-white">high</option>
                        <option value="medium" className="bg-[#121212] text-white">medium</option>
                        <option value="low" className="bg-[#121212] text-white">low</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-3 min-h-0 flex-1 overflow-auto">
                    {visibleFindings.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-[10px] text-[#8d8d96]">
                        No findings for the current scope and severity filter.
                      </div>
                    ) : (
                      <table className="w-full min-w-[1040px] table-fixed border-collapse">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[#7d7d86]">
                            <th className="pb-2 pr-3 font-medium">Severity</th>
                            <th className="pb-2 pr-3 font-medium">Kind</th>
                            <th className="pb-2 pr-3 font-medium">Resource</th>
                            <th className="pb-2 pr-3 font-medium">Evidence</th>
                            <th className="pb-2 pr-3 font-medium">Location</th>
                            <th className="pb-2 font-medium">Message</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleFindings.map((finding, index) => {
                            const findingResource = finding.resourceId ? resourcesById.get(finding.resourceId) ?? null : null;
                            const evidenceText = finding.rawEvidence ?? finding.evidence;
                            const severityClass = finding.severity === "high"
                              ? "text-rose-100"
                              : finding.severity === "medium"
                                ? "text-amber-100"
                                : "text-[#d1d1d8]";

                            return (
                              <tr
                                key={`${finding.kind}:${finding.location}:${index}`}
                                onClick={() => {
                                  if (finding.resourceId) {
                                    setSelectedResourceId(finding.resourceId);
                                    setActiveTab("dependencies");
                                  }
                                }}
                                className={`align-top text-[11px] transition ${finding.resourceId ? "cursor-pointer hover:bg-white/[0.04]" : ""} text-[#d2d2d8]`}
                              >
                                <td className={`px-2 py-2 pr-3 text-[10px] font-medium ${severityClass}`}>{finding.severity}</td>
                                <td className="px-2 py-2 pr-3 text-[10px]">{finding.kind}</td>
                                <td className="px-2 py-2 pr-3 text-[10px] text-[#bfc0c8]">{findingResource?.label ?? "-"}</td>
                                <td className="px-2 py-2 pr-3 text-[10px] text-[#cbccd3] break-all select-text">{evidenceText}</td>
                                <td className="px-2 py-2 pr-3 text-[10px] text-[#8f9098]">{finding.location}</td>
                                <td className="px-2 py-2 text-[10px]">{finding.message}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const crawlAuditApplication = defineApplication({
  id: CRAWL_AUDIT_APPLICATION_ID,
  title: "Crawl Auditor",
  View: CrawlAuditApp,
  getInitialTitle: (input: CrawlAuditInput) => getCrawlAuditTitle(input.url?.trim() ?? ""),
});