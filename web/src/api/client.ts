import type { NotebookDocument } from "../data";

const API_PREFIX = "/api";

type ApiEnvelope<T> = {
  ok: boolean;
  code?: string;
  created?: boolean;
  relativePath?: string;
  snapshotPath?: string;
  result?: T;
  error?: string;
};

export type RemoteIsbFileEntry = {
  relativePath: string;
  title: string;
  cellCount: number;
  trusted: boolean;
  savedAt: number;
};

export type RemoteNotebookSession = {
  code: string;
  created: boolean;
  relativePath: string;
  snapshotPath: string;
  notebook: NotebookDocument;
};

export type RemoteNotebookCellLanguage = "javascript" | "sql";

export type RemoteFsEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  mtimeMs: number;
};

export type RemoteFsDirectory = {
  path: string;
  entries: RemoteFsEntry[];
};

export type RemoteFsFile = {
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
  isText: boolean;
  content?: string;
  contentBase64?: string;
};

export type RemoteBrowserProfileEntry = {
  id: string;
  name: string;
  proxy?: string;
  userDataDir?: string;
  headless?: boolean;
  humanize?: boolean;
  isRunning: boolean;
  profileDir?: string;
  currentUrl?: string;
};

export type RemoteBrowserProxySelectionMode = "none" | "saved" | "preserve";

export type RemoteBrowserProxySelection = {
  label: string;
  mode: RemoteBrowserProxySelectionMode;
  proxyId: string | null;
};

export type RemoteBrowserProxyOption = {
  authConfigured: boolean;
  endpoint: string;
  id: string;
  name: string;
  type: "HTTP" | "HTTPS" | "SOCKS4" | "SOCKS4A" | "SOCKS5" | "SOCKS5H";
};

export type RemoteBrowserProfileSettings = {
  currentUrl: string | null;
  headless: boolean;
  humanize: boolean;
  id: string;
  isRunning: boolean;
  locale: string | null;
  name: string;
  proxySelection: RemoteBrowserProxySelection;
  searchEngine: string | null;
  timezone: string | null;
  userAgent: string | null;
  userDataDir: string | null;
  viewportHeight: number | null;
  viewportWidth: number | null;
};

export type RemoteBrowserProfileSelectionMode = "empty" | "preset" | "custom-existing";

export type RemoteBrowserViewportPreset = {
  category: string;
  description: string;
  deviceId: string;
  deviceName: string;
  height: number;
  id: string;
  label: string;
  orientation: "portrait" | "landscape";
  width: number;
};

export type RemoteBrowserSearchEnginePreset = {
  id: string;
  label: string;
  value: string;
};

export type RemoteBrowserUserAgentOption = {
  browserFamily: string;
  browserVersion: string | null;
  deviceClass: "desktop" | "mobile" | "tablet";
  label: string;
  osFamily: string;
  userAgent: string;
};

export type RemoteBrowserViewportSelection = {
  label: string | null;
  mode: RemoteBrowserProfileSelectionMode;
  presetId: string | null;
};

export type RemoteBrowserUserAgentSelection = {
  label: string | null;
  mode: RemoteBrowserProfileSelectionMode;
  userAgent: string | null;
};

export type RemoteMicrolinkUaStatus = {
  aiCount: number;
  crawlerCount: number;
  errorMessage: string | null;
  fetchStatus: "empty" | "success" | "error";
  fetchedAt: string | null;
  hasCachedPayload: boolean;
  isStale: boolean;
  microlinkUpdatedAt: number | null;
  sourceUrl: string;
  userAgentCount: number;
};

export type RemoteBrowserProfileEditorData = {
  searchEnginePresets: RemoteBrowserSearchEnginePreset[];
  userAgentOptions: RemoteBrowserUserAgentOption[];
  userAgentSelection: RemoteBrowserUserAgentSelection;
  viewportPresets: RemoteBrowserViewportPreset[];
  viewportSelection: RemoteBrowserViewportSelection;
};

export type RemoteMicrolinkUaPayload = {
	status: RemoteMicrolinkUaStatus;
	userAgents: string[];
};

export type RemoteBrowserTabEntry = {
  id: string;
  url: string;
  title?: string;
  active: boolean;
};

export type RemotePackageHostInfo = {
  archCompatible: boolean;
  bwrapExecutable: string | null;
  distro: {
    id: string | null;
    idLike: string[];
    name: string | null;
    prettyName: string | null;
    versionId: string | null;
  };
  isRoot: boolean;
  nspawnExecutable: string | null;
  pacstrapExecutable: string | null;
  platform: string;
  sudoExecutable: string | null;
};

export type RemotePackagePrivilegeLevel = "sandbox-ro" | "sandbox-rw" | "host-privileged";

export type RemotePackageSandboxSysMode = "off" | "host-ro" | "host-rw" | "sysfs";
export type RemotePackageSandboxDevMode = "sandbox" | "host";
export type RemotePackageSandboxProcMode = "sandbox" | "host-ro" | "host-rw";
export type RemotePackageSandboxBindMountMode = "ro-bind" | "bind" | "dev-bind";

export type RemotePackageSandboxBindMount = {
  mode: RemotePackageSandboxBindMountMode;
  source: string;
  target: string;
};

export type RemotePackageSandboxPolicyExtensions = {
  devMode: RemotePackageSandboxDevMode;
  extraBindMounts: RemotePackageSandboxBindMount[];
  procMode: RemotePackageSandboxProcMode;
  shareNetwork: boolean;
  sysMode: RemotePackageSandboxSysMode;
};

export type RemotePackageBoxEntry = {
  allowedPrivilegeLevels: RemotePackagePrivilegeLevel[];
  createdAt: number;
  defaultPrivilegeLevel: RemotePackagePrivilegeLevel;
  description?: string;
  id: string;
  lastError?: string;
  name: string;
  packages: string[];
  rootPath: string;
  sandboxPolicyExtensions: RemotePackageSandboxPolicyExtensions;
  status: "missing" | "building" | "ready" | "error";
  updatedAt: number;
};

export type RemoteSupportedPackageEntry = {
  id: string;
  package: string;
  description: string;
  bindings: Array<{
    id: string;
    description: string;
  }>;
  dependency: {
    pacman: readonly string[];
    paru: readonly string[];
  };
};

export type RemotePackageSnapshot = {
  boxes: RemotePackageBoxEntry[];
  defaultBoxId: string | null;
  hostInfo: RemotePackageHostInfo;
  supportedPackages: RemoteSupportedPackageEntry[];
};

export type RemotePackageInstallResult = {
  target: string;
  box: RemotePackageBoxEntry;
  packageIds: string[];
  pacmanPackages: string[];
  paruPackages: string[];
};

export type RemoteNotebookCompletionItem = {
  value: string;
  label?: string;
  detail?: string;
  kind: "command" | "module";
};

function buildApiError(message: string, status?: number): Error {
  const error = new Error(message);
  if (status !== undefined) {
    (error as Error & { status?: number }).status = status;
  }
  return error;
}

async function readApiEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  let payload: ApiEnvelope<T>;
  try {
    payload = await response.json() as ApiEnvelope<T>;
  } catch (error) {
    throw buildApiError(`Failed to decode API response: ${String(error)}`, response.status);
  }

  if (!response.ok || !payload.ok) {
    throw buildApiError(
      payload.error ?? `API request failed with status ${response.status}.`,
      response.status,
    );
  }

  return payload;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  return await readApiEnvelope<T>(response);
}

export function buildRemoteBrowserStreamUrl(
  target: string,
  options: { quality?: number; everyNthFrame?: number } = {},
): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}${API_PREFIX}/vm/browsers/stream`);
  url.searchParams.set("target", target);
  if (typeof options.quality === "number" && Number.isFinite(options.quality)) {
    url.searchParams.set("quality", String(Math.round(options.quality)));
  }

  if (typeof options.everyNthFrame === "number" && Number.isFinite(options.everyNthFrame)) {
    url.searchParams.set("everyNthFrame", String(Math.round(options.everyNthFrame)));
  }

  return url.toString();
}

export function buildRemotePackageBoxTerminalStreamUrl(
  target: string,
  options: { cols?: number; rows?: number } = {},
): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}${API_PREFIX}/vm/packages/terminal/stream`);
  url.searchParams.set("target", target);
  if (typeof options.cols === "number" && Number.isFinite(options.cols)) {
    url.searchParams.set("cols", String(Math.round(options.cols)));
  }

  if (typeof options.rows === "number" && Number.isFinite(options.rows)) {
    url.searchParams.set("rows", String(Math.round(options.rows)));
  }

  return url.toString();
}

function readNotebookSession(payload: ApiEnvelope<{ notebook?: NotebookDocument }>): RemoteNotebookSession {
  if (
    typeof payload.code !== "string"
    || typeof payload.created !== "boolean"
    || typeof payload.relativePath !== "string"
    || typeof payload.snapshotPath !== "string"
    || !payload.result?.notebook
  ) {
    throw buildApiError("Notebook session payload is incomplete.");
  }

  return {
    code: payload.code,
    created: payload.created,
    relativePath: payload.relativePath,
    snapshotPath: payload.snapshotPath,
    notebook: payload.result.notebook,
  };
}

export async function listRemoteIsbFiles(): Promise<RemoteIsbFileEntry[]> {
  const payload = await apiRequest<{ files?: RemoteIsbFileEntry[] }>("/vm/files", {
    method: "GET",
  });
  return payload.result?.files ?? [];
}

export async function openRemoteIsbFile(relativePath: string): Promise<RemoteNotebookSession> {
  const payload = await apiRequest<{ notebook?: NotebookDocument }>("/vm/files/open", {
    method: "POST",
    body: JSON.stringify({ path: relativePath }),
  });
  return readNotebookSession(payload);
}

export async function createRemoteIsbFile(relativePath: string): Promise<RemoteNotebookSession> {
  const payload = await apiRequest<{ notebook?: NotebookDocument }>("/vm/files/create", {
    method: "POST",
    body: JSON.stringify({ path: relativePath }),
  });
  return readNotebookSession(payload);
}

export async function deleteRemoteIsbFile(relativePath: string): Promise<{ path: string }> {
  const payload = await apiRequest<{ path?: string }>("/vm/files/delete", {
    method: "POST",
    body: JSON.stringify({ path: relativePath }),
  });

  if (typeof payload.result?.path !== "string") {
    throw buildApiError("Notebook delete payload is incomplete.");
  }

  return { path: payload.result.path };
}

export async function moveRemoteIsbFile(
  relativePath: string,
  targetPath: string,
): Promise<{ path: string; targetPath: string }> {
  const payload = await apiRequest<{ path?: string; targetPath?: string }>("/vm/files/move", {
    method: "POST",
    body: JSON.stringify({ path: relativePath, targetPath }),
  });

  if (typeof payload.result?.path !== "string" || typeof payload.result?.targetPath !== "string") {
    throw buildApiError("Notebook move payload is incomplete.");
  }

  return {
    path: payload.result.path,
    targetPath: payload.result.targetPath,
  };
}

export async function listRemoteCloakBrowsers(): Promise<RemoteBrowserProfileEntry[]> {
  const payload = await apiRequest<{ browsers?: RemoteBrowserProfileEntry[] }>("/vm/browsers", {
    method: "GET",
  });

  return payload.result?.browsers ?? [];
}

export async function getRemoteBrowserTabs(target: string): Promise<RemoteBrowserTabEntry[]> {
  const payload = await apiRequest<{ tabs?: RemoteBrowserTabEntry[] }>(`/vm/browsers/${encodeURIComponent(target)}/tabs`, {
    method: "GET",
  });

  return payload.result?.tabs ?? [];
}

export async function getRemoteBrowserProfileSettings(target: string): Promise<{
  editorData: RemoteBrowserProfileEditorData;
  profile: RemoteBrowserProfileSettings;
  proxyOptions: RemoteBrowserProxyOption[];
  target: string;
}> {
  const payload = await apiRequest<{
    editorData?: RemoteBrowserProfileEditorData;
    profile?: RemoteBrowserProfileSettings;
    proxyOptions?: RemoteBrowserProxyOption[];
    target?: string;
  }>(`/vm/browsers/${encodeURIComponent(target)}/profile`, {
    method: "GET",
  });

  if (!payload.result?.editorData || !payload.result.profile || !Array.isArray(payload.result.proxyOptions) || typeof payload.result.target !== "string") {
    throw buildApiError("Browser profile settings payload is incomplete.");
  }

  return {
    editorData: payload.result.editorData,
    profile: payload.result.profile,
    proxyOptions: payload.result.proxyOptions,
    target: payload.result.target,
  };
}

export async function saveRemoteBrowserProfileSettings(
  target: string,
  input: {
    headless: boolean;
    humanize: boolean;
    locale?: string | null;
    name: string;
    proxySelection: {
      mode: RemoteBrowserProxySelectionMode;
      proxyId?: string;
    };
    searchEngine?: string | null;
    timezone?: string | null;
    userAgent?: string | null;
    userDataDir?: string | null;
    viewportHeight?: number | null;
    viewportWidth?: number | null;
  },
): Promise<{
  editorData: RemoteBrowserProfileEditorData;
  profile: RemoteBrowserProfileSettings;
  proxyOptions: RemoteBrowserProxyOption[];
  target: string;
}> {
  const payload = await apiRequest<{
    editorData?: RemoteBrowserProfileEditorData;
    profile?: RemoteBrowserProfileSettings;
    proxyOptions?: RemoteBrowserProxyOption[];
    target?: string;
  }>(`/vm/browsers/${encodeURIComponent(target)}/profile`, {
    method: "POST",
    body: JSON.stringify(input),
  });

  if (!payload.result?.editorData || !payload.result.profile || !Array.isArray(payload.result.proxyOptions) || typeof payload.result.target !== "string") {
    throw buildApiError("Browser profile save payload is incomplete.");
  }

  return {
    editorData: payload.result.editorData,
    profile: payload.result.profile,
    proxyOptions: payload.result.proxyOptions,
    target: payload.result.target,
  };
}

export async function getRemoteMicrolinkUaPayload(): Promise<RemoteMicrolinkUaPayload> {
  const payload = await apiRequest<RemoteMicrolinkUaPayload>("/vm/kits/microlink-ua", {
    method: "GET",
  });

  if (!payload.result?.status || !Array.isArray(payload.result.userAgents)) {
    throw buildApiError("Microlink UA payload is incomplete.");
  }

  return payload.result;
}

export async function refreshRemoteMicrolinkUaPayload(): Promise<RemoteMicrolinkUaPayload> {
  const payload = await apiRequest<RemoteMicrolinkUaPayload>("/vm/kits/microlink-ua", {
    method: "POST",
  });

  if (!payload.result?.status || !Array.isArray(payload.result.userAgents)) {
    throw buildApiError("Microlink UA refresh payload is incomplete.");
  }

  return payload.result;
}

export async function activateRemoteBrowserTab(target: string, tabId: string): Promise<{ target: string; tabId: string }> {
  const payload = await apiRequest<{ target?: string; tabId?: string }>(`/vm/browsers/${encodeURIComponent(target)}/tabs/activate`, {
    method: "POST",
    body: JSON.stringify({ tabId }),
  });

  if (typeof payload.result?.target !== "string" || typeof payload.result?.tabId !== "string") {
    throw buildApiError("Browser tab activation payload is incomplete.");
  }

  return {
    target: payload.result.target,
    tabId: payload.result.tabId,
  };
}

export async function launchRemoteCloakBrowser(target: string): Promise<{ target: string }> {
  const payload = await apiRequest<{ target?: string }>("/vm/browsers/launch", {
    method: "POST",
    body: JSON.stringify({ target }),
  });

  if (typeof payload.result?.target !== "string") {
    throw buildApiError("Browser launch payload is incomplete.");
  }

  return { target: payload.result.target };
}

export async function stopRemoteCloakBrowser(target: string): Promise<{ target: string }> {
  const payload = await apiRequest<{ target?: string }>("/vm/browsers/stop", {
    method: "POST",
    body: JSON.stringify({ target }),
  });

  if (typeof payload.result?.target !== "string") {
    throw buildApiError("Browser stop payload is incomplete.");
  }

  return { target: payload.result.target };
}

export async function navigateRemoteCloakBrowser(target: string, url: string): Promise<{ target: string }> {
  const payload = await apiRequest<{ target?: string }>("/vm/browsers/navigate", {
    method: "POST",
    body: JSON.stringify({ target, url }),
  });

  if (typeof payload.result?.target !== "string") {
    throw buildApiError("Browser navigate payload is incomplete.");
  }

  return { target: payload.result.target };
}

export async function captureRemoteCloakBrowserScreenshot(target: string): Promise<string | null> {
  const payload = await apiRequest<{ dataUrl?: string | null }>("/vm/browsers/screenshot", {
    method: "POST",
    body: JSON.stringify({ target }),
  });

  return payload.result?.dataUrl ?? null;
}

export async function clickRemoteCloakBrowser(target: string, x: number, y: number): Promise<{ target: string }> {
  const payload = await apiRequest<{ target?: string }>("/vm/browsers/click", {
    method: "POST",
    body: JSON.stringify({ target, x, y }),
  });

  if (typeof payload.result?.target !== "string") {
    throw buildApiError("Browser click payload is incomplete.");
  }

  return { target: payload.result.target };
}

export async function gestureRemoteCloakBrowser(
  target: string,
  points: Array<{ x: number; y: number }>,
): Promise<{ target: string }> {
  const payload = await apiRequest<{ target?: string }>("/vm/browsers/gesture", {
    method: "POST",
    body: JSON.stringify({ target, points }),
  });

  if (typeof payload.result?.target !== "string") {
    throw buildApiError("Browser gesture payload is incomplete.");
  }

  return { target: payload.result.target };
}

export async function wheelRemoteCloakBrowser(
  target: string,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<{ target: string }> {
  const payload = await apiRequest<{ target?: string }>("/vm/browsers/wheel", {
    method: "POST",
    body: JSON.stringify({ target, x, y, deltaX, deltaY }),
  });

  if (typeof payload.result?.target !== "string") {
    throw buildApiError("Browser wheel payload is incomplete.");
  }

  return { target: payload.result.target };
}

export async function keyboardRemoteCloakBrowser(
  target: string,
  input: {
    key: string;
    code?: string;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  },
): Promise<{ target: string }> {
  const payload = await apiRequest<{ target?: string }>("/vm/browsers/keyboard", {
    method: "POST",
    body: JSON.stringify({ target, ...input }),
  });

  if (typeof payload.result?.target !== "string") {
    throw buildApiError("Browser keyboard payload is incomplete.");
  }

  return { target: payload.result.target };
}

export async function listRemotePackages(): Promise<RemotePackageSnapshot> {
  const payload = await apiRequest<RemotePackageSnapshot>("/vm/packages", {
    method: "GET",
  });

  if (!payload.result) {
    throw buildApiError("Packages snapshot payload is missing.");
  }

  return payload.result;
}

export async function createRemotePackageBox(input: {
  id: string;
  name?: string;
  description?: string;
  packages?: string[];
  defaultPrivilegeLevel?: RemotePackagePrivilegeLevel;
  allowedPrivilegeLevels?: RemotePackagePrivilegeLevel[];
  sandboxPolicyExtensions?: Partial<RemotePackageSandboxPolicyExtensions>;
}): Promise<RemotePackageBoxEntry> {
  const payload = await apiRequest<{ box?: RemotePackageBoxEntry }>("/vm/packages/create", {
    method: "POST",
    body: JSON.stringify(input),
  });

  if (!payload.result?.box) {
    throw buildApiError("Package box create payload is incomplete.");
  }

  return payload.result.box;
}

export async function selectRemotePackageBox(target: string): Promise<RemotePackageBoxEntry> {
  const payload = await apiRequest<{ target?: string; box?: RemotePackageBoxEntry }>("/vm/packages/select", {
    method: "POST",
    body: JSON.stringify({ target }),
  });

  if (payload.result?.target !== target || !payload.result.box) {
    throw buildApiError("Package box select payload is incomplete.");
  }

  return payload.result.box;
}

export async function deleteRemotePackageBox(target: string): Promise<{ defaultBoxId: string | null; target: string }> {
  const payload = await apiRequest<{ defaultBoxId?: string | null; target?: string }>("/vm/packages/delete", {
    method: "POST",
    body: JSON.stringify({ target }),
  });

  if (payload.result?.target !== target) {
    throw buildApiError("Package box delete payload is incomplete.");
  }

  return {
    defaultBoxId: typeof payload.result.defaultBoxId === "string" || payload.result.defaultBoxId === null
      ? payload.result.defaultBoxId
      : null,
    target: payload.result.target,
  };
}

export async function installRemotePackageSet(
  packages: string[],
  target?: string,
): Promise<RemotePackageInstallResult> {
  const payload = await apiRequest<RemotePackageInstallResult>("/vm/packages/install", {
    method: "POST",
    body: JSON.stringify({ packages, target }),
  });

  if (!payload.result?.target || !payload.result.box) {
    throw buildApiError("Package install payload is incomplete.");
  }

  return payload.result;
}

export async function setRemotePackageBoxPrivilege(input: {
  target: string;
  defaultPrivilegeLevel?: RemotePackagePrivilegeLevel;
  allowedPrivilegeLevels?: RemotePackagePrivilegeLevel[];
  sandboxPolicyExtensions?: Partial<RemotePackageSandboxPolicyExtensions>;
}): Promise<RemotePackageBoxEntry> {
  const payload = await apiRequest<{ target?: string; box?: RemotePackageBoxEntry }>("/vm/packages/privilege", {
    method: "POST",
    body: JSON.stringify(input),
  });

  if (payload.result?.target !== input.target || !payload.result.box) {
    throw buildApiError("Package privilege payload is incomplete.");
  }

  return payload.result.box;
}

export async function saveRemoteNotebook(code: string, notebook: NotebookDocument): Promise<RemoteNotebookSession> {
  const payload = await apiRequest<{ notebook?: NotebookDocument }>(`/vm/${encodeURIComponent(code)}/file`, {
    method: "POST",
    body: JSON.stringify({ notebook }),
  });
  return readNotebookSession(payload);
}

export async function restartRemoteNotebook(code: string): Promise<RemoteNotebookSession> {
  const payload = await apiRequest<{ notebook?: NotebookDocument }>(`/vm/${encodeURIComponent(code)}/restart`, {
    method: "POST",
  });
  return readNotebookSession(payload);
}

export async function reloadRemoteNotebook(code: string): Promise<RemoteNotebookSession> {
  const payload = await apiRequest<{ notebook?: NotebookDocument }>(`/vm/${encodeURIComponent(code)}/reload`, {
    method: "POST",
  });
  return readNotebookSession(payload);
}

export async function evaluateRemoteCell(
  code: string,
  source: string,
  options: { language?: RemoteNotebookCellLanguage } = {},
): Promise<unknown> {
  const payload = await apiRequest<unknown>(`/vm/${encodeURIComponent(code)}/eval`, {
    method: "POST",
    body: JSON.stringify({ code: source, language: options.language }),
  });
  return payload.result;
}

export async function getRemoteNotebookCompletions(
  code: string,
  fragment: string,
  options: { language?: RemoteNotebookCellLanguage; signal?: AbortSignal } = {},
): Promise<RemoteNotebookCompletionItem[]> {
  const payload = await apiRequest<{ items?: RemoteNotebookCompletionItem[] }>(`/vm/${encodeURIComponent(code)}/completions`, {
    method: "POST",
    body: JSON.stringify({ fragment, language: options.language }),
    signal: options.signal,
  });

  return payload.result?.items ?? [];
}

export async function listRemoteVmFs(code: string, targetPath: string): Promise<RemoteFsDirectory> {
  const payload = await apiRequest<RemoteFsDirectory>(`/vm/${encodeURIComponent(code)}/fs/list?path=${encodeURIComponent(targetPath)}`, {
    method: "GET",
  });

  if (!payload.result) {
    throw buildApiError("Filesystem listing payload is missing.");
  }

  return payload.result;
}

export async function readRemoteVmFsFile(code: string, targetPath: string): Promise<RemoteFsFile> {
  const payload = await apiRequest<RemoteFsFile>(`/vm/${encodeURIComponent(code)}/fs/read?path=${encodeURIComponent(targetPath)}`, {
    method: "GET",
  });

  if (!payload.result) {
    throw buildApiError("Filesystem file payload is missing.");
  }

  return payload.result;
}

export async function writeRemoteVmFsFile(
  code: string,
  targetPath: string,
  options: { content?: string; contentBase64?: string },
): Promise<{ path: string; size: number; mtimeMs: number }> {
  const payload = await apiRequest<{ path: string; size: number; mtimeMs: number }>(`/vm/${encodeURIComponent(code)}/fs/write`, {
    method: "POST",
    body: JSON.stringify({
      path: targetPath,
      content: options.content,
      contentBase64: options.contentBase64,
    }),
  });

  if (!payload.result) {
    throw buildApiError("Filesystem write payload is missing.");
  }

  return payload.result;
}

export async function createRemoteVmFsDirectory(code: string, targetPath: string): Promise<{ path: string }> {
  const payload = await apiRequest<{ path: string }>(`/vm/${encodeURIComponent(code)}/fs/mkdir`, {
    method: "POST",
    body: JSON.stringify({ path: targetPath }),
  });

  if (!payload.result) {
    throw buildApiError("Filesystem mkdir payload is missing.");
  }

  return payload.result;
}

export async function deleteRemoteVmFsEntry(
  code: string,
  targetPath: string,
  recursive = true,
): Promise<{ path: string }> {
  const payload = await apiRequest<{ path: string }>(`/vm/${encodeURIComponent(code)}/fs/delete`, {
    method: "POST",
    body: JSON.stringify({ path: targetPath, recursive }),
  });

  if (!payload.result) {
    throw buildApiError("Filesystem delete payload is missing.");
  }

  return payload.result;
}

export async function downloadRemoteVmFsFile(code: string, targetPath: string): Promise<Blob> {
  const response = await fetch(`${API_PREFIX}/vm/${encodeURIComponent(code)}/fs/download?path=${encodeURIComponent(targetPath)}`, {
    method: "GET",
  });
  if (!response.ok) {
    let message = `API request failed with status ${response.status}.`;
    try {
      const payload = await response.json() as ApiEnvelope<unknown>;
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // Ignore JSON parse failures for binary download errors.
    }

    throw buildApiError(message, response.status);
  }

  return await response.blob();
}