import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import {
  deleteRemoteSavedHttpClientRequest,
  executeRemoteHttpClientRequest,
  getRemoteSavedHttpClientRequest,
  importRemoteCurlRequest,
  listRemoteSavedHttpClientRequests,
  saveRemoteHttpClientRequest,
  type RemoteHttpClientExecuteResult,
  type RemoteHttpClientFieldEntry,
  type RemoteHttpClientResponseSnapshot,
  type RemoteSavedHttpClientRequest,
} from "../api/client";
import PostmanRequestHeadersTable from "./postman-request-headers-table.tsx";
import PostmanResponseHeadersTable from "./postman-response-headers-table.tsx";
import {
  defineApplication,
  type ApplicationViewProps,
} from "./application";
import {
  ApplicationActionButton,
  ApplicationAlert,
  ApplicationChoiceButton,
  ApplicationEmptyState,
  ApplicationHeader,
  ApplicationPanel,
  ApplicationSurface,
} from "./application-layout.tsx";
import workbookTheme from "../theme.tsx";

export const POSTMAN_APPLICATION_ID = "applications/postman";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

type RequestEditorTab = "query" | "headers" | "body";
type ResponseViewerTab = "body" | "headers";

export type PostmanInput = {
  savedRequestId?: string | null;
};

function createFieldEntry(input: Partial<RemoteHttpClientFieldEntry> = {}): RemoteHttpClientFieldEntry {
  return {
    id: input.id ?? crypto.randomUUID(),
    key: input.key ?? "",
    value: input.value ?? "",
    enabled: input.enabled ?? true,
  };
}

function normalizeEditableEntries(entries: readonly RemoteHttpClientFieldEntry[]): RemoteHttpClientFieldEntry[] {
  if (entries.length === 0) {
    return [createFieldEntry()];
  }

  return entries.map((entry) => createFieldEntry(entry));
}

function getPersistableEntries(entries: readonly RemoteHttpClientFieldEntry[]): RemoteHttpClientFieldEntry[] {
  return entries
    .map((entry) => ({
      ...entry,
      key: entry.key.trim(),
      value: entry.value,
    }))
    .filter((entry) => entry.key.length > 0);
}

function createHeaderRecord(entries: readonly RemoteHttpClientFieldEntry[]): Record<string, string> {
  return Object.fromEntries(
    getPersistableEntries(entries)
      .filter((entry) => entry.enabled)
      .map((entry) => [entry.key, entry.value]),
  );
}

function splitDraftUrl(inputUrl: string): { requestUrl: string; queryEntries: RemoteHttpClientFieldEntry[] } {
  if (inputUrl.trim().length === 0) {
    return { requestUrl: "", queryEntries: [createFieldEntry()] };
  }

  try {
    const parsedUrl = new URL(inputUrl);
    const queryEntries = [...parsedUrl.searchParams.entries()].map(([key, value]) => createFieldEntry({ key, value }));
    parsedUrl.search = "";

    return {
      requestUrl: parsedUrl.toString(),
      queryEntries: queryEntries.length > 0 ? queryEntries : [createFieldEntry()],
    };
  } catch {
    return { requestUrl: inputUrl, queryEntries: [createFieldEntry()] };
  }
}

function buildFinalRequestUrl(requestUrl: string, queryEntries: readonly RemoteHttpClientFieldEntry[]): string {
  const trimmedUrl = requestUrl.trim();
  if (trimmedUrl.length === 0) {
    return trimmedUrl;
  }

  const parsedUrl = new URL(trimmedUrl);
  parsedUrl.search = "";
  for (const entry of getPersistableEntries(queryEntries)) {
    if (!entry.enabled) {
      continue;
    }

    parsedUrl.searchParams.append(entry.key, entry.value);
  }

  return parsedUrl.toString();
}

function createPersistedSnapshot(result: RemoteHttpClientExecuteResult | null): RemoteHttpClientResponseSnapshot | null {
  if (!result?.response) {
    return null;
  }

  return {
    statusCode: result.response.status,
    durationMs: result.response.durationMs,
    responseHeaders: result.response.headers,
    responseBodyPreview: result.response.bodyPreview,
    responseContentType: result.response.contentType,
    responseSizeBytes: result.response.sizeBytes,
    executedAt: new Date().toISOString(),
  };
}

function upsertSavedRequest(
  requests: readonly RemoteSavedHttpClientRequest[],
  nextRequest: RemoteSavedHttpClientRequest,
): RemoteSavedHttpClientRequest[] {
  const nextRequests = [nextRequest, ...requests.filter((request) => request.id !== nextRequest.id)];
  return nextRequests.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function getPostmanApplicationTitle(name: string, method: string, requestUrl: string): string {
  const trimmedName = name.trim();
  if (trimmedName.length > 0) {
    return trimmedName;
  }

  const trimmedUrl = requestUrl.trim();
  if (trimmedUrl.length === 0) {
    return "Postman · new request";
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    const label = parsedUrl.pathname && parsedUrl.pathname !== "/"
      ? `${parsedUrl.host}${parsedUrl.pathname}`
      : parsedUrl.host;
    return `${method.toUpperCase()} · ${label}`;
  } catch {
    return `${method.toUpperCase()} · ${trimmedUrl}`;
  }
}

function getPostmanSaveNameSuggestion(name: string, method: string, requestUrl: string): string {
  const trimmedName = name.trim();
  if (trimmedName.length > 0) {
    return trimmedName;
  }

  const derivedTitle = getPostmanApplicationTitle("", method, requestUrl);
  if (derivedTitle === "Postman · new request") {
    return `${method.toUpperCase()} request`;
  }

  return derivedTitle;
}

function getSavedRequestSummary(method: string, requestUrl: string): string {
  const trimmedUrl = requestUrl.trim();
  return trimmedUrl.length > 0 ? `${method} · ${trimmedUrl}` : method;
}

function looksLikeCurlCommand(value: string): boolean {
  return /^curl(?:\s|$)/u.test(value.trimStart());
}

function findHeaderValue(headers: Record<string, string>, headerName: string): string | null {
  const normalizedHeaderName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedHeaderName) {
      return value;
    }
  }

  return null;
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

function TabButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <ApplicationChoiceButton onClick={onClick} isActive={isActive} className="px-3 font-medium">
      {label}
    </ApplicationChoiceButton>
  );
}

function EmptyState({ text }: { text: string }) {
  return <ApplicationEmptyState text={text} />;
}

function FieldEntryEditor({
  entries,
  onChange,
}: {
  entries: RemoteHttpClientFieldEntry[];
  onChange: (entries: RemoteHttpClientFieldEntry[]) => void;
}) {
  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div key={entry.id} className={`flex items-center gap-2 rounded-[14px] ${workbookTheme.surface.panel} px-3 py-2`}>
          <label className={`flex items-center gap-2 text-[10px] ${workbookTheme.text.muted}`}>
            <input
              type="checkbox"
              checked={entry.enabled}
              onChange={(event) => onChange(entries.map((item) => item.id === entry.id ? { ...item, enabled: event.target.checked } : item))}
              className="h-3.5 w-3.5 accent-white/80"
            />
          </label>
          <input
            value={entry.key}
            onChange={(event) => onChange(entries.map((item) => item.id === entry.id ? { ...item, key: event.target.value } : item))}
            placeholder="Key"
            className={`min-w-0 flex-1 bg-transparent text-[12px] ${workbookTheme.text.canvas} outline-none ${workbookTheme.text.placeholder}`}
          />
          <div className={`h-4 w-px ${workbookTheme.line.default}`} />
          <input
            value={entry.value}
            onChange={(event) => onChange(entries.map((item) => item.id === entry.id ? { ...item, value: event.target.value } : item))}
            placeholder="Value"
            className={`min-w-0 flex-[1.2] bg-transparent text-[12px] ${workbookTheme.text.canvas} outline-none ${workbookTheme.text.placeholder}`}
          />
          <button
            type="button"
            onClick={() => onChange(entries.filter((item) => item.id !== entry.id))}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] ${workbookTheme.text.control} transition ${workbookTheme.interaction.buttonSubtle} hover:text-white`}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...entries, createFieldEntry()])}
        className={`rounded-[12px] ${workbookTheme.surface.softAccent} px-3 py-1.5 text-[10px] font-medium ${workbookTheme.text.bodySoft} transition ${workbookTheme.interaction.hoverStrong}`}
      >
        Add row
      </button>
    </div>
  );
}

function PostmanApp({
  instance,
  setTitle,
}: ApplicationViewProps<PostmanInput>) {
  const [savedRequests, setSavedRequests] = useState<RemoteSavedHttpClientRequest[]>([]);
  const [selectedSavedRequestId, setSelectedSavedRequestId] = useState<string | null>(instance.input.savedRequestId ?? null);
  const [requestName, setRequestName] = useState("");
  const [method, setMethod] = useState<string>("GET");
  const [requestUrl, setRequestUrl] = useState("");
  const [queryEntries, setQueryEntries] = useState<RemoteHttpClientFieldEntry[]>([createFieldEntry()]);
  const [headerEntries, setHeaderEntries] = useState<RemoteHttpClientFieldEntry[]>([createFieldEntry()]);
  const [bodyKind, setBodyKind] = useState("text");
  const [bodyText, setBodyText] = useState("");
  const [requestTab, setRequestTab] = useState<RequestEditorTab>("query");
  const [responseTab, setResponseTab] = useState<ResponseViewerTab>("body");
  const [executeResult, setExecuteResult] = useState<RemoteHttpClientExecuteResult | null>(null);
  const [persistedSnapshot, setPersistedSnapshot] = useState<RemoteHttpClientResponseSnapshot | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSavedRequests, setIsLoadingSavedRequests] = useState(false);
  const [isImportingCurl, setIsImportingCurl] = useState(false);
  const [isCreatingSavedRequest, setIsCreatingSavedRequest] = useState(false);
  const [pendingSavedRequestName, setPendingSavedRequestName] = useState("");
  const [saveDraftError, setSaveDraftError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const pendingSavedRequestInputRef = useRef<HTMLInputElement | null>(null);

  const appTitle = useMemo(
    () => getPostmanApplicationTitle(requestName, method, requestUrl),
    [method, requestName, requestUrl],
  );

  useEffect(() => {
    setTitle(appTitle);
  }, [appTitle, setTitle]);

  useEffect(() => {
    if (!isCreatingSavedRequest) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      pendingSavedRequestInputRef.current?.focus();
      pendingSavedRequestInputRef.current?.select();
      pendingSavedRequestInputRef.current?.scrollIntoView({ block: "nearest" });
    });

    return () => cancelAnimationFrame(frameId);
  }, [isCreatingSavedRequest]);

  async function refreshSavedRequests(): Promise<void> {
    setIsLoadingSavedRequests(true);
    try {
      const requests = await listRemoteSavedHttpClientRequests({ limit: 100 });
      setSavedRequests(requests);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingSavedRequests(false);
    }
  }

  function applySavedRequest(savedRequest: RemoteSavedHttpClientRequest): void {
    setIsCreatingSavedRequest(false);
    setPendingSavedRequestName("");
    setSaveDraftError(null);
    setSelectedSavedRequestId(savedRequest.id);
    setRequestName(savedRequest.name);
    setMethod(savedRequest.method);
    setRequestUrl(savedRequest.url);
    setQueryEntries(normalizeEditableEntries(savedRequest.query));
    setHeaderEntries(normalizeEditableEntries(savedRequest.headers));
    setBodyText(savedRequest.bodyText ?? "");
    setBodyKind(savedRequest.bodyKind ?? "text");
    setPersistedSnapshot(savedRequest.lastResponseSnapshot);
    setExecuteResult(null);
    setOperationError(null);
  }

  async function loadSavedRequest(id: string): Promise<void> {
    setOperationError(null);
    try {
      const savedRequest = await getRemoteSavedHttpClientRequest(id);
      if (!savedRequest) {
        setOperationError("Saved request was not found.");
        return;
      }

      applySavedRequest(savedRequest);
      setSavedRequests((currentRequests) => upsertSavedRequest(currentRequests, savedRequest));
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void refreshSavedRequests();
  }, []);

  useEffect(() => {
    if (!instance.input.savedRequestId) {
      return;
    }

    void loadSavedRequest(instance.input.savedRequestId);
  }, [instance.input.savedRequestId]);

  async function persistCurrentRequest(
    nextSnapshot: RemoteHttpClientResponseSnapshot | null,
    nameOverride?: string,
  ): Promise<RemoteSavedHttpClientRequest> {
    const trimmedName = (nameOverride ?? requestName).trim();
    if (trimmedName.length === 0) {
      throw new Error("Request name is required to save this request.");
    }

    const savedRequest = await saveRemoteHttpClientRequest({
      id: selectedSavedRequestId ?? undefined,
      name: trimmedName,
      method,
      url: requestUrl.trim(),
      headers: getPersistableEntries(headerEntries),
      query: getPersistableEntries(queryEntries),
      bodyText: bodyText.length > 0 ? bodyText : null,
      bodyKind,
      lastResponseSnapshot: nextSnapshot,
    });

    setSavedRequests((currentRequests) => upsertSavedRequest(currentRequests, savedRequest));
    setSelectedSavedRequestId(savedRequest.id);
    setRequestName(savedRequest.name);
    setPersistedSnapshot(savedRequest.lastResponseSnapshot);
    return savedRequest;
  }

  async function handleSaveSelectedRequest(): Promise<void> {
    setIsSaving(true);
    setOperationError(null);
    try {
      await persistCurrentRequest(createPersistedSnapshot(executeResult) ?? persistedSnapshot, requestName);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateSavedRequest(): Promise<void> {
    setIsSaving(true);
    setSaveDraftError(null);
    try {
      await persistCurrentRequest(createPersistedSnapshot(executeResult) ?? persistedSnapshot, pendingSavedRequestName);
      setIsCreatingSavedRequest(false);
      setPendingSavedRequestName("");
    } catch (error) {
      setSaveDraftError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExecute(): Promise<void> {
    if (requestUrl.trim().length === 0) {
      setOperationError("Request URL is required.");
      return;
    }

    setIsExecuting(true);
    setOperationError(null);
    try {
      const result = await executeRemoteHttpClientRequest({
        method,
        url: buildFinalRequestUrl(requestUrl, queryEntries),
        headers: createHeaderRecord(headerEntries),
        bodyText: bodyText.length > 0 ? bodyText : null,
      });
      setExecuteResult(result);

      const nextSnapshot = createPersistedSnapshot(result);
      if (nextSnapshot) {
        setPersistedSnapshot(nextSnapshot);
      }

      if (selectedSavedRequestId) {
        await persistCurrentRequest(nextSnapshot, requestName);
      }
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExecuting(false);
    }
  }

  async function handleImportCurl(curlCommand: string): Promise<void> {
    if (curlCommand.trim().length === 0) {
      return;
    }

    setIsImportingCurl(true);
    setOperationError(null);
    try {
      const importedRequest = await importRemoteCurlRequest(curlCommand);
      const splitUrl = splitDraftUrl(importedRequest.url);
      setMethod(importedRequest.method);
      setRequestUrl(splitUrl.requestUrl);
      setQueryEntries(splitUrl.queryEntries);
      setHeaderEntries(normalizeEditableEntries(
        Object.entries(importedRequest.headers).map(([key, value]) => createFieldEntry({ key, value })),
      ));
      setBodyText(importedRequest.bodyText ?? "");
      setBodyKind(findHeaderValue(importedRequest.headers, "content-type")?.toLowerCase().includes("json") ? "json" : "text");
      setRequestTab(importedRequest.bodyText ? "body" : Object.keys(importedRequest.headers).length > 0 ? "headers" : "query");
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsImportingCurl(false);
    }
  }

  async function handleDeleteSavedRequest(id: string): Promise<void> {
    setOperationError(null);
    try {
      const deleted = await deleteRemoteSavedHttpClientRequest(id);
      if (!deleted) {
        return;
      }

      setSavedRequests((currentRequests) => currentRequests.filter((request) => request.id !== id));
      if (selectedSavedRequestId === id) {
        setSelectedSavedRequestId(null);
        setPersistedSnapshot(null);
      }
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    }
  }

  function startNewDraft(): void {
    setIsCreatingSavedRequest(true);
    setPendingSavedRequestName("");
    setSaveDraftError(null);
    setSelectedSavedRequestId(null);
    setRequestName("");
    setMethod("GET");
    setRequestUrl("");
    setQueryEntries([createFieldEntry()]);
    setHeaderEntries([createFieldEntry()]);
    setBodyKind("text");
    setBodyText("");
    setExecuteResult(null);
    setPersistedSnapshot(null);
    setOperationError(null);
  }

  const responseSnapshot = executeResult?.response
    ? createPersistedSnapshot(executeResult)
    : persistedSnapshot;
  const responseBody = executeResult?.response?.bodyText ?? responseSnapshot?.responseBodyPreview ?? null;
  const responseHeaders = executeResult?.response?.headers ?? responseSnapshot?.responseHeaders ?? {};

  return (
    <ApplicationSurface>
      <ApplicationHeader
        title="Postman"
        subtitle="Saved HTTP requests and request composer."
        alert={operationError ? <ApplicationAlert>{operationError}</ApplicationAlert> : undefined}
      />

      <div className="min-h-0 flex-1 pt-2">
        <div className="grid min-h-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <ApplicationPanel
            title="Saved Requests"
            className="min-h-0"
          >
            <div className="min-h-0 overflow-auto pr-1">
              {isLoadingSavedRequests ? (
                <EmptyState text="Loading saved requests..." />
              ) : savedRequests.length > 0 || isCreatingSavedRequest ? (
                <div className={`overflow-hidden rounded-[14px] ${workbookTheme.surface.panelMuted}`}>
                  {savedRequests.map((savedRequest) => (
                    <div
                      key={savedRequest.id}
                      className={`border-t ${workbookTheme.border.subtle} transition first:border-t-0 ${
                        savedRequest.id === selectedSavedRequestId
                          ? workbookTheme.interaction.active
                          : workbookTheme.interaction.hover
                      }`}
                    >
                      <div className="flex items-start gap-2 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => { void loadSavedRequest(savedRequest.id); }}
                          className="min-w-0 grow text-left"
                        >
                          <p className={`truncate text-[12px] font-medium ${workbookTheme.text.primary}`}>{savedRequest.name}</p>
                          <p className={`mt-1.5 truncate text-[10px] ${workbookTheme.text.secondary}`}>{getSavedRequestSummary(savedRequest.method, savedRequest.url)}</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => { void handleDeleteSavedRequest(savedRequest.id); }}
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] ${workbookTheme.text.control} transition ${workbookTheme.interaction.buttonSubtle} hover:text-white`}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}

                  {isCreatingSavedRequest ? (
                    <div className={`border-t ${workbookTheme.border.subtle} ${workbookTheme.surface.overlay}`}>
                      <div className="px-3 py-3">
                        <input
                          ref={pendingSavedRequestInputRef}
                          value={pendingSavedRequestName}
                          onChange={(event) => {
                            setPendingSavedRequestName(event.target.value);
                            if (saveDraftError) {
                              setSaveDraftError(null);
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleCreateSavedRequest();
                            }
                          }}
                          placeholder={getPostmanSaveNameSuggestion("", method, requestUrl)}
                          className={`w-full bg-transparent text-[12px] font-medium ${workbookTheme.text.primary} outline-none ${workbookTheme.text.placeholderSoft}`}
                          autoFocus
                          disabled={isSaving}
                        />
                        {saveDraftError ? (
                          <p className="mt-1.5 text-[10px] text-rose-200">{saveDraftError}</p>
                        ) : (
                          <p className={`mt-1.5 text-[9px] uppercase tracking-[0.14em] ${workbookTheme.text.tertiary}`}>Press Enter to save</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState text="No saved requests yet." />
              )}
            </div>

            <div className="mt-3">
              <ActionButton onClick={startNewDraft} className={`w-full justify-center ${workbookTheme.interaction.buttonSubtle}`}>
                New
              </ActionButton>
            </div>
          </ApplicationPanel>

          <div className="min-h-0 flex flex-col gap-3">
            <ApplicationPanel title="Request">
              <div className={`overflow-hidden rounded-[14px] ${workbookTheme.surface.panel}`}>
                <div className="flex flex-col sm:flex-row sm:items-stretch">
                  <div className={`border-b ${workbookTheme.border.default} sm:min-w-[118px] sm:border-b-0 sm:border-r`}>
                    <select
                      value={method}
                      onChange={(event) => setMethod(event.target.value)}
                      disabled={isImportingCurl}
                      className={`h-full w-full bg-transparent px-3 py-2.5 text-[12px] ${workbookTheme.text.canvas} outline-none`}
                    >
                      {HTTP_METHODS.map((httpMethod) => (
                        <option key={httpMethod} value={httpMethod}>{httpMethod}</option>
                      ))}
                    </select>
                  </div>

                  <div className={`min-w-0 flex-1 border-b ${workbookTheme.border.default} sm:border-b-0 sm:border-r`}>
                    <input
                      value={requestUrl}
                      onChange={(event) => setRequestUrl(event.target.value)}
                      onPaste={(event) => {
                        const pastedText = event.clipboardData.getData("text");
                        if (!looksLikeCurlCommand(pastedText)) {
                          return;
                        }

                        event.preventDefault();
                        void handleImportCurl(pastedText);
                      }}
                      disabled={isImportingCurl}
                      placeholder="https://api.example.com/resource"
                      className={`w-full bg-transparent px-3 py-2.5 text-[12px] ${workbookTheme.text.canvas} outline-none ${workbookTheme.text.placeholder}`}
                    />
                  </div>

                  <ActionButton
                    onClick={() => { void handleExecute(); }}
                    disabled={isExecuting || isImportingCurl}
                    className={`min-w-[104px] rounded-none ${workbookTheme.surface.panelStrong} px-4 py-2.5 text-[11px] ${workbookTheme.interaction.panelHoverStrong}`}
                  >
                    {isExecuting ? "Sending..." : "Send"}
                  </ActionButton>
                </div>
              </div>

              <div className={`mt-3 flex items-center gap-1 rounded-[12px] ${workbookTheme.surface.panel} p-1`}>
                {([
                  ["query", "Query"],
                  ["headers", "Headers"],
                  ["body", "Body"],
                ] as const).map(([tabId, label]) => (
                  <TabButton
                    key={tabId}
                    label={label}
                    isActive={requestTab === tabId}
                    onClick={() => setRequestTab(tabId)}
                  />
                ))}
              </div>

              <div className="mt-3">
                {requestTab === "query" ? (
                  <FieldEntryEditor entries={queryEntries} onChange={setQueryEntries} />
                ) : requestTab === "headers" ? (
                  <PostmanRequestHeadersTable entries={headerEntries} onChange={setHeaderEntries} />
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-[0.14em] text-[#7b7b85]">Body type</span>
                      <select
                        value={bodyKind}
                        onChange={(event) => setBodyKind(event.target.value)}
                        className={`rounded-[10px] ${workbookTheme.surface.panel} px-3 py-1.5 text-[11px] ${workbookTheme.text.canvas} outline-none`}
                      >
                        <option value="text">Raw text</option>
                        <option value="json">JSON</option>
                      </select>
                    </div>
                    <textarea
                      value={bodyText}
                      onChange={(event) => setBodyText(event.target.value)}
                      placeholder={bodyKind === "json" ? '{"hello": true}' : "Request body"}
                      className={`h-48 w-full resize-none rounded-[14px] ${workbookTheme.surface.panel} p-4 font-mono text-[11px] leading-relaxed ${workbookTheme.text.body} outline-none ${workbookTheme.text.placeholder}`}
                      spellCheck={false}
                    />
                  </div>
                )}
              </div>

              {selectedSavedRequestId ? (
                <div className="mt-4 flex justify-end">
                  <ActionButton
                    onClick={() => { void handleSaveSelectedRequest(); }}
                    disabled={isSaving}
                    className={`${workbookTheme.interaction.buttonSubtle} px-4 py-2 text-[11px] disabled:opacity-50`}
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </ActionButton>
                </div>
              ) : null}
            </ApplicationPanel>

            <ApplicationPanel
              title="Response"
              action={(
                <div className={`flex items-center gap-1 rounded-[12px] ${workbookTheme.surface.panel} p-1`}>
                  {([
                    ["body", "Body"],
                    ["headers", "Headers"],
                  ] as const).map(([tabId, label]) => (
                    <TabButton
                      key={tabId}
                      label={label}
                      isActive={responseTab === tabId}
                      onClick={() => setResponseTab(tabId)}
                    />
                  ))}
                </div>
              )}
              className="min-h-0 flex-1"
            >
              <div className="flex h-full min-h-[280px] flex-col">
                {executeResult?.error ? (
                  <div className="mb-3">
                    <ApplicationAlert>
                      <div>
                        <p>{executeResult.error.message}</p>
                        {executeResult.error.code ? (
                          <p className={`mt-1 uppercase tracking-[0.14em] ${workbookTheme.text.muted}`}>{executeResult.error.code}</p>
                        ) : null}
                      </div>
                    </ApplicationAlert>
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-auto">
                  {responseTab === "body" ? (
                    responseBody ? (
                      <pre className={`overflow-auto rounded-[14px] ${workbookTheme.surface.panel} p-4 text-[11px] leading-relaxed ${workbookTheme.text.body} whitespace-pre-wrap break-words`}>
                        {responseBody}
                      </pre>
                    ) : (
                      <EmptyState text="No response body available yet." />
                    )
                  ) : Object.keys(responseHeaders).length > 0 ? (
                    <PostmanResponseHeadersTable headers={responseHeaders} />
                  ) : (
                    <EmptyState text="No response headers available yet." />
                  )}
                </div>
              </div>
            </ApplicationPanel>
          </div>
        </div>
      </div>

    </ApplicationSurface>
  );
}

export const postmanApplication = defineApplication<PostmanInput>({
  id: POSTMAN_APPLICATION_ID,
  title: "Postman",
  View: PostmanApp,
});