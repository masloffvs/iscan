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

export type RemoteIsbFolderEntry = {
  relativePath: string;
};

export type RemoteIsbSearchEntry = {
  relativePath: string;
  notebookTitle: string;
  cellId: string;
  cellTitle: string;
  cellKind: "markdown" | "code" | "sql";
  cellLanguage?: string;
  preview: string;
  score: number;
};

export type RemoteNotebookSession = {
  code: string;
  created: boolean;
  relativePath: string;
  snapshotPath: string;
  notebook: NotebookDocument;
};

export type RemoteNotebookCellLanguage = "javascript" | "sql";

export type RemoteNotebookTypePayload = {
  source: string;
};

export type RemoteVmInspectorBinding = {
  name: string;
  type: string;
  preview: string;
};

export type RemoteVmInspectorMemoryUsage = {
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  rssMb: number;
  heapTotalMb: number;
  heapUsedMb: number;
  externalMb: number;
  arrayBuffersMb: number;
};

export type RemoteVmInspectorActiveEvaluation = {
  taskId: string | null;
  language: RemoteNotebookCellLanguage;
  cellId: string | null;
  previousCellId: string | null;
  startedAt: string;
  durationMs: number;
  sourcePreview: string;
  sourceLineCount: number;
};

export type RemoteVmInspectorExecutionState = {
  activeTaskId: string | null;
  queueLength: number;
  tasks: RemoteVmExecutionTask[];
};

export type RemoteVmInspectorNodeKind =
  | "root"
  | "binding"
  | "helper"
  | "property"
  | "index"
  | "map-value"
  | "set-entry"
  | "prototype";

export type RemoteVmInspectorNodeDescriptor = {
  enumerable: boolean;
  configurable: boolean;
  writable: boolean | null;
  getter: boolean;
  setter: boolean;
};

export type RemoteVmInspectorNode = {
  handle: string;
  name: string;
  kind: RemoteVmInspectorNodeKind;
  type: string;
  preview: string;
  constructorName: string | null;
  expandable: boolean;
  childCount: number | null;
  originCellId: string | null;
  descriptor: RemoteVmInspectorNodeDescriptor | null;
};

export type RemoteVmInspectorRootGroup = {
  id: string;
  title: string;
  subtitle: string | null;
  nodes: RemoteVmInspectorNode[];
};

export type RemoteVmInspectorNodePathEntry = {
  handle: string;
  label: string;
};

export type RemoteVmInspectorNodeDetails = {
  node: RemoteVmInspectorNode;
  path: RemoteVmInspectorNodePathEntry[];
  children: RemoteVmInspectorNode[];
};

export type RemoteVmInspectorVmState = {
  prepared: boolean;
  persistedCellCount: number;
  userBindingCount: number;
  userBindings: RemoteVmInspectorBinding[];
  rootEntries: string[];
};

export type RemoteVmInspectorCellResult = {
  cellId: string;
  language: RemoteNotebookCellLanguage;
  executedAt: string;
  preview: string;
};

export type RemoteVmInspectorRuntimeKit = {
  id: string;
  name: string;
  category: string | null;
  active: boolean;
};

export type RemoteVmInspectorWorkerMemoryUsage = {
  rssMb: number;
  heapTotalMb: number;
  heapUsedMb: number;
  externalMb: number;
  arrayBuffersMb: number;
};

export type RemoteVmInspectorWorker = {
  id: string;
  name: string;
  relativeScriptPath: string;
  status: "starting" | "running" | "stopping" | "stopped" | "error";
  pid: number;
  startedAt: string;
  updatedAt: string;
  lastEvent: string | null;
  lastLog: string | null;
  lastLogLevel: "debug" | "info" | "warn" | "error" | null;
  uptimeSeconds: number | null;
  memoryUsage: RemoteVmInspectorWorkerMemoryUsage | null;
};

export type RemoteSettingsEditorKind = "string" | "number" | "boolean" | "enum" | "string[]" | "json";

export type RemoteSettingsEditorDefinition = {
  kind: RemoteSettingsEditorKind;
  enumValues?: string[];
  placeholder?: string;
  multiline?: boolean;
};

export type RemoteSettingsGroup = {
  id: string;
  label: string;
  description?: string;
  order: number;
  settingCount: number;
};

export type RemoteResolvedSettingValue = {
  id: string;
  value: unknown;
  source: "stored" | "default" | "invalid-stored-default";
  updatedAt?: string;
  validationError?: string;
};

export type RemoteSettingDefinition = {
  id: string;
  label: string;
  description?: string;
  groupId: string | null;
  groupLabel: string | null;
  secret: boolean;
  order: number;
  hasDefault: boolean;
  editor: RemoteSettingsEditorDefinition;
  defaultSummary?: string;
};

export type RemoteSettingSnapshot = {
  definition: RemoteSettingDefinition;
  value?: RemoteResolvedSettingValue;
  missing: boolean;
};

export type RemoteSettingsCatalog = {
  groups: RemoteSettingsGroup[];
  settings: RemoteSettingSnapshot[];
};

export type RemoteVmInspectorSnapshot = {
  code: string;
  relativePath: string | null;
  notebookTitle: string | null;
  notebookCellCount: number;
  inspectedAt: string;
  snapshotPath: string;
  activeEvaluation: RemoteVmInspectorActiveEvaluation | null;
  execution: RemoteVmInspectorExecutionState;
  memoryUsage: RemoteVmInspectorMemoryUsage;
  vm: RemoteVmInspectorVmState;
  recentCellResults: RemoteVmInspectorCellResult[];
  runtimeKits: RemoteVmInspectorRuntimeKit[];
  backgroundWorkers: RemoteVmInspectorWorker[];
};

export type RemoteVmInspectorReadyEvent = {
  type: "ready";
};

export type RemoteVmInspectorStateEvent = {
  type: "state";
  snapshot: RemoteVmInspectorSnapshot;
  rootGroups: RemoteVmInspectorRootGroup[];
};

export type RemoteVmInspectorNodeEvent = {
  type: "node";
  handle: string;
  details: RemoteVmInspectorNodeDetails;
};

export type RemoteVmInspectorNodeErrorEvent = {
  type: "node-error";
  handle: string;
  error: string;
};

export type RemoteVmInspectorErrorEvent = {
  type: "error";
  error: string;
};

export type RemoteVmInspectorCancelAckEvent = {
  type: "cancel-ack";
  taskId: string;
  accepted: boolean;
  status: RemoteVmExecutionTaskState | "unknown";
  message?: string;
};

export type RemoteVmInspectorStreamEvent =
  | RemoteVmInspectorReadyEvent
  | RemoteVmInspectorStateEvent
  | RemoteVmInspectorNodeEvent
  | RemoteVmInspectorNodeErrorEvent
  | RemoteVmInspectorCancelAckEvent
  | RemoteVmInspectorErrorEvent;

export type RemoteVmInspectorStreamHandle = {
  socket: WebSocket;
  requestNode: (handle: string) => void;
  cancelTask: (taskId: string) => void;
  close: () => void;
};

export type RemoteVmExecutionTaskState = "queued" | "running" | "completed" | "failed" | "cancelled";

export type RemoteVmExecutionTask = {
  taskId: string;
  code: string;
  language: RemoteNotebookCellLanguage;
  cellId: string | null;
  previousCellId: string | null;
  status: RemoteVmExecutionTaskState;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  sourcePreview: string;
  sourceLineCount: number;
  cancelRequested: boolean;
  queuePosition: number | null;
  queueLength: number;
  logs: string[];
  logLineCount: number;
};

export type RemoteVmExecutionReadyEvent = {
  type: "ready";
};

export type RemoteVmExecutionQueuedEvent = {
  type: "queued";
  task: RemoteVmExecutionTask;
};

export type RemoteVmExecutionQueueEvent = {
  type: "queue";
  task: RemoteVmExecutionTask;
};

export type RemoteVmExecutionStartedEvent = {
  type: "started";
  task: RemoteVmExecutionTask;
};

export type RemoteVmExecutionResultEvent = {
  type: "result";
  taskId: string;
  result: unknown;
};

export type RemoteVmExecutionErrorEvent = {
  type: "error";
  taskId: string;
  error: string;
};

export type RemoteVmExecutionCancelledEvent = {
  type: "cancelled";
  task: RemoteVmExecutionTask;
  reason: string;
};

export type RemoteVmExecutionCompleteEvent = {
  type: "complete";
  task: RemoteVmExecutionTask;
};

export type RemoteVmExecutionCancelAckEvent = {
  type: "cancel-ack";
  taskId: string;
  accepted: boolean;
  status: RemoteVmExecutionTaskState | "unknown";
  message?: string;
};

export type RemoteVmExecutionOutputEvent = {
  type: "output";
  stream: "stdout" | "stderr";
  data: string;
  isBinary: boolean;
};

export type RemoteVmExecutionStreamEvent =
  | RemoteVmExecutionReadyEvent
  | RemoteVmExecutionQueuedEvent
  | RemoteVmExecutionQueueEvent
  | RemoteVmExecutionStartedEvent
  | RemoteVmExecutionResultEvent
  | RemoteVmExecutionErrorEvent
  | RemoteVmExecutionCancelledEvent
  | RemoteVmExecutionCompleteEvent
  | RemoteVmExecutionCancelAckEvent
  | RemoteVmExecutionOutputEvent;

export type RemoteVmExecutionStreamHandle = {
  socket: WebSocket;
  execute: (input: {
    code: string;
    source: string;
    language?: RemoteNotebookCellLanguage;
    cellId?: string;
    previousCellId?: string;
  }) => void;
  cancel: (taskId?: string) => void;
  close: () => void;
};

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

export type RemoteBrowserUserAgentSearchPayload = {
	query?: string;
	suggestions?: RemoteBrowserUserAgentOption[];
};

export type RemoteMicrolinkUaPayload = {
	status: RemoteMicrolinkUaStatus;
	userAgents: string[];
};

export type RemoteBrowserTabEntry = {
  id: string;
  url: string;
  title?: string;
  faviconUrl?: string;
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

export type RemotePackageBoxPolicy = {
  allowHostPrivileged: boolean;
  allowSandboxRw: boolean;
  defaultSandboxRw: boolean;
  hostDev: boolean;
  hostProc: boolean;
  hostSys: boolean;
  shareNetwork: boolean;
  unshareUser: boolean;
  unshareIpc: boolean;
  unsharePid: boolean;
  unshareUts: boolean;
  unshareCgroup: boolean;
};

export type RemotePackageBoxPolicyInput = Partial<RemotePackageBoxPolicy>;

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

export type RemotePackageBoxEntry = RemotePackageBoxPolicy & {
  createdAt: number;
  description?: string;
  id: string;
  lastError?: string;
  name: string;
  packages: string[];
  rootPath: string;
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

export type RemoteCommandPaletteParam = {
  name: string;
  detail?: string;
  example?: string;
  required?: boolean;
  values?: readonly string[];
  valueType?: "string" | "number" | "boolean" | "json" | "string[]";
  jsDescriptorName?: string;
};

export type RemoteCommandPaletteCommand = {
  id: string;
  aliases: string[];
  category: string;
  title: string;
  description: string | null;
  keywords: string[];
  defaultParameterName: string | null;
  consoleParams: RemoteCommandPaletteParam[];
  hasRequiredParams: boolean;
  subInput: {
    label: string | null;
    placeholder: string | null;
    submitLabel: string | null;
  } | null;
};

export type RemoteCommandPaletteRunResult = {
  commandId: string;
  durationMs: number;
  result: unknown;
};

export type RemoteAuditCrawlFetchMode = "http" | "browser";

export type RemoteAuditCrawlParams = {
  url: string;
  timeoutMs?: number;
  maxAssets?: number;
  maxAssetKb?: number;
  sameOriginOnly?: boolean;
  fetchMode?: RemoteAuditCrawlFetchMode;
  cloakProfileId?: string;
  renderMs?: number;
};

export type RemoteAuditCrawlSeverity = "high" | "medium" | "low";

export type RemoteAuditCrawlResourceKind =
  | "document"
  | "script"
  | "style"
  | "modulepreload"
  | "fetch"
  | "xhr"
  | "image"
  | "font"
  | "media"
  | "manifest"
  | "source-map"
  | "source-file"
  | "other";

export type RemoteAuditCrawlDiscoveryKind = "document" | "html" | "network" | "sourcemap" | "bundle-import";

export type RemoteAuditCrawlFinding = {
  severity: RemoteAuditCrawlSeverity;
  kind: string;
  location: string;
  evidence: string;
  rawEvidence?: string;
  message: string;
  resourceId?: string;
};

export type RemoteAuditCrawlResourceNode = {
  id: string;
  kind: RemoteAuditCrawlResourceKind;
  url: string;
  label: string;
  status: string;
  discoveredBy: RemoteAuditCrawlDiscoveryKind;
  sameOrigin: boolean;
  scanned: boolean;
  isDynamic: boolean;
  contentType?: string;
  bytes?: number;
  parentUrl?: string;
  initiatorUrl?: string;
  note?: string;
  hasSourceMap: boolean;
  sourceMapUrl?: string;
};

export type RemoteAuditCrawlEdgeKind = "loads" | "imports" | "references-source-map" | "contains-source";

export type RemoteAuditCrawlEdge = {
  from: string;
  to: string;
  kind: RemoteAuditCrawlEdgeKind;
  note?: string;
};

export type RemoteAuditCrawlStats = {
  resourcesDiscovered: number;
  resourcesScanned: number;
  resourcesSkipped: number;
  inlineScriptsScanned: number;
  sourceMapsDiscovered: number;
  sourceMapsFetched: number;
  externalResources: number;
  dynamicResources: number;
};

export type RemoteAuditCrawlResult = {
  url: string;
  auditedAt: string;
  entryResourceId: string;
  findings: RemoteAuditCrawlFinding[];
  resources: RemoteAuditCrawlResourceNode[];
  edges: RemoteAuditCrawlEdge[];
  stats: RemoteAuditCrawlStats;
};

export type RemoteExploitEntry = {
  exploitId: string;
  title: string;
  typeDisplay: string | null;
  platformDisplay: string | null;
  authorName: string | null;
  datePublished: string | null;
  verified: boolean;
  applicationMd5: string | null;
  port: number | null;
  rawUrl: string;
  downloadUrl: string;
  metadata: Record<string, unknown> | null;
};

export type RemoteExploitRaw = {
  exploitId: string;
  fetchStatus: "success" | "error";
  errorMessage: string | null;
  bodyText: string | null;
  contentType: string | null;
  fetchedAt: string;
};

export type RemoteExploitViewerData = {
  entry: RemoteExploitEntry | null;
  raw: RemoteExploitRaw | null;
};

export type RemoteHttpClientFieldEntry = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

export type RemoteHttpClientResponseSnapshot = {
  statusCode: number | null;
  durationMs: number | null;
  responseHeaders: Record<string, string>;
  responseBodyPreview: string | null;
  responseContentType: string | null;
  responseSizeBytes: number | null;
  executedAt: string | null;
};

export type RemoteSavedHttpClientRequest = {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: RemoteHttpClientFieldEntry[];
  query: RemoteHttpClientFieldEntry[];
  bodyText: string | null;
  bodyKind: string | null;
  lastResponseSnapshot: RemoteHttpClientResponseSnapshot | null;
  createdAt: string;
  updatedAt: string;
};

export type RemoteHttpClientExecuteRequestInput = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  bodyText?: string | null;
  timeoutMs?: number;
};

export type RemoteHttpClientExecuteResult = {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    bodyText: string | null;
    timeoutMs: number;
  };
  response: {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    contentType: string | null;
    bodyText: string | null;
    bodyPreview: string | null;
    sizeBytes: number;
    durationMs: number;
  } | null;
  error: {
    code: string | null;
    message: string;
  } | null;
};

export type RemoteImportedCurlRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyText: string | null;
  timeoutMs: number;
};

export type RemoteZoomEyeHostEntry = {
  ip: string;
  port: number;
  queryText: string | null;
  service: string | null;
  transport: string | null;
  product: string | null;
  hostname: string | null;
  os: string | null;
  title: string | null;
  body: string | null;
  header: string | null;
  banner: string | null;
  organization: string | null;
  countryCode: string | null;
  countryNameEn: string | null;
  lastPulledAt: string;
};

export type RemoteAiConnectionSummary = {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  providerName: string | null;
  systemPrompt: string | null;
  createdAt: string;
  updatedAt: string;
  selected: boolean;
};

export type RemoteAiAgentChatMessage = {
  role: "system" | "user" | "assistant";
  text: string;
};

export type RemoteAiAgentChatUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type RemoteAiAgentChatReply = {
  text: string;
  usage?: RemoteAiAgentChatUsage;
  finishReason: string | null;
};

export type RemoteAiAgentChatResult = {
  connection: {
    id: string;
    name: string;
    provider: string;
    model: string;
    baseUrl: string | null;
    providerName: string | null;
    selected: boolean;
  };
  request: {
    system: string | null;
    temperature: number | null;
    maxOutputTokens: number | null;
  };
  reply: RemoteAiAgentChatReply;
};

export type RemoteZoomEyePullSummary = {
  authenticatedUser: string;
  cloakProfileId: string;
  cloakProfileLabel: string;
  inserted: number;
  maxResults: number;
  pageSize: number;
  pagesFetched: number;
  rawMatches: number;
  requestedCloakProfileId: string | null;
  startPage: number;
  uniqueMatches: number;
  updated: number;
};

export type RemoteZoomEyePullResult = {
  queryBase64: string;
  queryText: string | null;
  searchType: string;
  fetchedAt: string;
  summary: RemoteZoomEyePullSummary;
  entries: RemoteZoomEyeHostEntry[];
};

export type RemoteZoomEyePassiveCaptureEvent = {
  capturedAt: string;
  errorMessage: string | null;
  pageId: string | null;
  pageUrl: string | null;
  requestUrl: string;
  method: string;
  resourceType: string;
  status: number;
  queryBase64: string;
  queryText: string | null;
  searchType: string;
  page: number;
  pageSize: number;
  rawMatches: number;
  uniqueMatches: number;
  inserted: number;
  updated: number;
};

export type RemoteZoomEyePassiveCaptureSession = {
  captureId: string;
  active: boolean;
  profileRunning: boolean;
  cloakProfileId: string;
  cloakProfileLabel: string;
  startedAt: string;
  lastCapturedAt: string | null;
  currentUrl: string | null;
  totalCaptured: number;
  recentEvents: RemoteZoomEyePassiveCaptureEvent[];
};

export type RemoteZoomEyeHostDetail = {
  id: number;
  ip: string;
  port: number;
  queryBase64: string;
  queryText: string | null;
  searchType: string;
  pageSize: number;
  matchType: string | null;
  service: string | null;
  transport: string | null;
  product: string | null;
  hostname: string | null;
  os: string | null;
  title: string | null;
  extraInfo: string | null;
  body: string | null;
  header: string | null;
  banner: string | null;
  token: string | null;
  qid: string | null;
  zoomeyeTimestamp: string | null;
  countryCode: string | null;
  countryNameEn: string | null;
  countryNameCn: string | null;
  cityNameEn: string | null;
  cityNameCn: string | null;
  subdivisionNameEn: string | null;
  subdivisionNameCn: string | null;
  organization: string | null;
  asn: string | null;
  firstPulledAt: string;
  lastPulledAt: string;
  raw: Record<string, unknown> | null;
};

export type RemotePortScanSelectionMode = "ports" | "topPorts";

export type RemotePortScanResult = {
  host: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ports: string | null;
  topPorts: number | null;
  selectionMode: RemotePortScanSelectionMode;
  concurrency: number;
  connectTimeoutMs: number;
  scannedPortCount: number;
  openPorts: number[];
  openPortCount: number;
  errorMessage: string | null;
  persisted: boolean;
  scanId: string | null;
};

export type RemotePortScanSavedScan = RemotePortScanResult & {
  persisted: true;
  scanId: string;
};

export type RemotePortScanPolicy = {
  allowHosts: string[];
  denyHosts: string[];
  allowPrivateAddresses: boolean;
  allowLoopback: boolean;
  denyPublicAddresses: boolean;
};

export type RemotePortScanCommandExamples = {
  scan: string[];
  list: string[];
  get: string[];
};

export type RemotePortScanPolicySnapshot = {
  policy: RemotePortScanPolicy;
  defaults: {
    topPorts: number;
    concurrency: number;
    connectTimeoutMs: number;
  };
  maxTopPorts: number;
  topPortsPreview: number[];
  examples: RemotePortScanCommandExamples;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRemoteExploitEntry(value: unknown): RemoteExploitEntry | null {
  if (!isRecord(value) || typeof value.exploitId !== "string" || typeof value.title !== "string") {
    return null;
  }

  return {
    exploitId: value.exploitId,
    title: value.title,
    typeDisplay: typeof value.typeDisplay === "string" ? value.typeDisplay : null,
    platformDisplay: typeof value.platformDisplay === "string" ? value.platformDisplay : null,
    authorName: typeof value.authorName === "string" ? value.authorName : null,
    datePublished: typeof value.datePublished === "string" ? value.datePublished : null,
    verified: value.verified === true,
    applicationMd5: typeof value.applicationMd5 === "string" ? value.applicationMd5 : null,
    port: typeof value.port === "number" ? value.port : null,
    rawUrl: typeof value.rawUrl === "string" ? value.rawUrl : "",
    downloadUrl: typeof value.downloadUrl === "string" ? value.downloadUrl : "",
    metadata: isRecord(value.metadata) ? value.metadata : null,
  };
}

function parseRemoteExploitRaw(value: unknown): RemoteExploitRaw | null {
  if (!isRecord(value) || typeof value.exploitId !== "string" || typeof value.fetchStatus !== "string") {
    return null;
  }

  return {
    exploitId: value.exploitId,
    fetchStatus: value.fetchStatus === "error" ? "error" : "success",
    errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : null,
    bodyText: typeof value.bodyText === "string" ? value.bodyText : null,
    contentType: typeof value.contentType === "string" ? value.contentType : null,
    fetchedAt: typeof value.fetchedAt === "string" ? value.fetchedAt : "",
  };
}

function parseRemoteAiConnectionSummary(value: unknown): RemoteAiConnectionSummary | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.provider !== "string" || typeof value.model !== "string") {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    provider: value.provider,
    model: value.model,
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : null,
    providerName: typeof value.providerName === "string" ? value.providerName : null,
    systemPrompt: typeof value.systemPrompt === "string" ? value.systemPrompt : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    selected: value.selected === true,
  };
}

function parseRemoteAiAgentChatUsage(value: unknown): RemoteAiAgentChatUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    inputTokens: typeof value.inputTokens === "number" ? value.inputTokens : undefined,
    outputTokens: typeof value.outputTokens === "number" ? value.outputTokens : undefined,
    totalTokens: typeof value.totalTokens === "number" ? value.totalTokens : undefined,
  };
}

function parseRemoteAiAgentChatReply(value: unknown): RemoteAiAgentChatReply | null {
  if (!isRecord(value) || typeof value.text !== "string") {
    return null;
  }

  return {
    text: value.text,
    usage: parseRemoteAiAgentChatUsage(value.usage),
    finishReason: typeof value.finishReason === "string" ? value.finishReason : null,
  };
}

function parseRemoteAiAgentChatResult(value: unknown): RemoteAiAgentChatResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const connectionRecord = isRecord(value.connection) ? value.connection : null;
  const requestRecord = isRecord(value.request) ? value.request : null;
  const reply = parseRemoteAiAgentChatReply(value.reply);

  if (!connectionRecord || !requestRecord || !reply || typeof connectionRecord.id !== "string" || typeof connectionRecord.name !== "string" || typeof connectionRecord.provider !== "string" || typeof connectionRecord.model !== "string") {
    return null;
  }

  return {
    connection: {
      id: connectionRecord.id,
      name: connectionRecord.name,
      provider: connectionRecord.provider,
      model: connectionRecord.model,
      baseUrl: typeof connectionRecord.baseUrl === "string" ? connectionRecord.baseUrl : null,
      providerName: typeof connectionRecord.providerName === "string" ? connectionRecord.providerName : null,
      selected: connectionRecord.selected === true,
    },
    request: {
      system: typeof requestRecord.system === "string" ? requestRecord.system : null,
      temperature: typeof requestRecord.temperature === "number" ? requestRecord.temperature : null,
      maxOutputTokens: typeof requestRecord.maxOutputTokens === "number" ? requestRecord.maxOutputTokens : null,
    },
    reply,
  };
}

function parseRemoteStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function parseRemoteVmInspectorMemoryUsage(value: unknown): RemoteVmInspectorMemoryUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  const fields = [
    "rssBytes",
    "heapTotalBytes",
    "heapUsedBytes",
    "externalBytes",
    "arrayBuffersBytes",
    "rssMb",
    "heapTotalMb",
    "heapUsedMb",
    "externalMb",
    "arrayBuffersMb",
  ] as const;

  if (!fields.every((field) => typeof value[field] === "number")) {
    return null;
  }

  return {
    rssBytes: value.rssBytes,
    heapTotalBytes: value.heapTotalBytes,
    heapUsedBytes: value.heapUsedBytes,
    externalBytes: value.externalBytes,
    arrayBuffersBytes: value.arrayBuffersBytes,
    rssMb: value.rssMb,
    heapTotalMb: value.heapTotalMb,
    heapUsedMb: value.heapUsedMb,
    externalMb: value.externalMb,
    arrayBuffersMb: value.arrayBuffersMb,
  };
}

function parseRemoteVmInspectorBinding(value: unknown): RemoteVmInspectorBinding | null {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.type !== "string" || typeof value.preview !== "string") {
    return null;
  }

  return {
    name: value.name,
    type: value.type,
    preview: value.preview,
  };
}

function parseRemoteVmInspectorNodeDescriptor(value: unknown): RemoteVmInspectorNodeDescriptor | null {
  if (!isRecord(value) || typeof value.enumerable !== "boolean" || typeof value.configurable !== "boolean" || typeof value.getter !== "boolean" || typeof value.setter !== "boolean") {
    return null;
  }

  return {
    enumerable: value.enumerable,
    configurable: value.configurable,
    writable: typeof value.writable === "boolean" ? value.writable : null,
    getter: value.getter,
    setter: value.setter,
  };
}

function parseRemoteVmInspectorNode(value: unknown): RemoteVmInspectorNode | null {
  if (!isRecord(value) || typeof value.handle !== "string" || typeof value.name !== "string" || typeof value.kind !== "string" || typeof value.type !== "string" || typeof value.preview !== "string" || typeof value.expandable !== "boolean") {
    return null;
  }

  const kind = value.kind;
  if (kind !== "root" && kind !== "binding" && kind !== "helper" && kind !== "property" && kind !== "index" && kind !== "map-value" && kind !== "set-entry" && kind !== "prototype") {
    return null;
  }

  return {
    handle: value.handle,
    name: value.name,
    kind,
    type: value.type,
    preview: value.preview,
    constructorName: typeof value.constructorName === "string" ? value.constructorName : null,
    expandable: value.expandable,
    childCount: typeof value.childCount === "number" ? value.childCount : null,
    originCellId: typeof value.originCellId === "string" ? value.originCellId : null,
    descriptor: value.descriptor === null || value.descriptor === undefined
      ? null
      : parseRemoteVmInspectorNodeDescriptor(value.descriptor),
  };
}

function parseRemoteVmInspectorRootGroup(value: unknown): RemoteVmInspectorRootGroup | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string" || !Array.isArray(value.nodes)) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    subtitle: typeof value.subtitle === "string" ? value.subtitle : null,
    nodes: value.nodes
      .map(parseRemoteVmInspectorNode)
      .filter((entry): entry is RemoteVmInspectorNode => Boolean(entry)),
  };
}

function parseRemoteVmInspectorNodePathEntry(value: unknown): RemoteVmInspectorNodePathEntry | null {
  if (!isRecord(value) || typeof value.handle !== "string" || typeof value.label !== "string") {
    return null;
  }

  return {
    handle: value.handle,
    label: value.label,
  };
}

function parseRemoteVmInspectorNodeDetails(value: unknown): RemoteVmInspectorNodeDetails | null {
  if (!isRecord(value) || !Array.isArray(value.path) || !Array.isArray(value.children)) {
    return null;
  }

  const node = parseRemoteVmInspectorNode(value.node);
  if (!node) {
    return null;
  }

  return {
    node,
    path: value.path
      .map(parseRemoteVmInspectorNodePathEntry)
      .filter((entry): entry is RemoteVmInspectorNodePathEntry => Boolean(entry)),
    children: value.children
      .map(parseRemoteVmInspectorNode)
      .filter((entry): entry is RemoteVmInspectorNode => Boolean(entry)),
  };
}

function parseRemoteVmInspectorActiveEvaluation(value: unknown): RemoteVmInspectorActiveEvaluation | null {
  if (!isRecord(value) || typeof value.language !== "string" || typeof value.startedAt !== "string" || typeof value.durationMs !== "number" || typeof value.sourcePreview !== "string" || typeof value.sourceLineCount !== "number") {
    return null;
  }

  return {
    taskId: typeof value.taskId === "string" ? value.taskId : null,
    language: value.language === "sql" ? "sql" : "javascript",
    cellId: typeof value.cellId === "string" ? value.cellId : null,
    previousCellId: typeof value.previousCellId === "string" ? value.previousCellId : null,
    startedAt: value.startedAt,
    durationMs: value.durationMs,
    sourcePreview: value.sourcePreview,
    sourceLineCount: value.sourceLineCount,
  };
}

function parseRemoteVmInspectorVmState(value: unknown): RemoteVmInspectorVmState | null {
  if (!isRecord(value) || typeof value.prepared !== "boolean" || typeof value.persistedCellCount !== "number" || typeof value.userBindingCount !== "number" || !Array.isArray(value.userBindings) || !Array.isArray(value.rootEntries)) {
    return null;
  }

  const userBindings = value.userBindings
    .map(parseRemoteVmInspectorBinding)
    .filter((entry): entry is RemoteVmInspectorBinding => Boolean(entry));

  return {
    prepared: value.prepared,
    persistedCellCount: value.persistedCellCount,
    userBindingCount: value.userBindingCount,
    userBindings,
    rootEntries: value.rootEntries.filter((entry): entry is string => typeof entry === "string"),
  };
}

function parseRemoteVmInspectorCellResult(value: unknown): RemoteVmInspectorCellResult | null {
  if (!isRecord(value) || typeof value.cellId !== "string" || typeof value.language !== "string" || typeof value.executedAt !== "string" || typeof value.preview !== "string") {
    return null;
  }

  return {
    cellId: value.cellId,
    language: value.language === "sql" ? "sql" : "javascript",
    executedAt: value.executedAt,
    preview: value.preview,
  };
}

function parseRemoteVmInspectorRuntimeKit(value: unknown): RemoteVmInspectorRuntimeKit | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.active !== "boolean") {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    category: typeof value.category === "string" ? value.category : null,
    active: value.active,
  };
}

function parseRemoteVmInspectorWorkerMemoryUsage(value: unknown): RemoteVmInspectorWorkerMemoryUsage | null {
  if (!isRecord(value) || typeof value.rssMb !== "number" || typeof value.heapTotalMb !== "number" || typeof value.heapUsedMb !== "number" || typeof value.externalMb !== "number" || typeof value.arrayBuffersMb !== "number") {
    return null;
  }

  return {
    rssMb: value.rssMb,
    heapTotalMb: value.heapTotalMb,
    heapUsedMb: value.heapUsedMb,
    externalMb: value.externalMb,
    arrayBuffersMb: value.arrayBuffersMb,
  };
}

function parseRemoteVmInspectorWorker(value: unknown): RemoteVmInspectorWorker | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.relativeScriptPath !== "string" || typeof value.status !== "string" || typeof value.pid !== "number" || typeof value.startedAt !== "string" || typeof value.updatedAt !== "string") {
    return null;
  }

  const status = value.status;
  if (status !== "starting" && status !== "running" && status !== "stopping" && status !== "stopped" && status !== "error") {
    return null;
  }

  const lastLogLevel = value.lastLogLevel;
  if (lastLogLevel !== null && lastLogLevel !== undefined && lastLogLevel !== "debug" && lastLogLevel !== "info" && lastLogLevel !== "warn" && lastLogLevel !== "error") {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    relativeScriptPath: value.relativeScriptPath,
    status,
    pid: value.pid,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    lastEvent: typeof value.lastEvent === "string" ? value.lastEvent : null,
    lastLog: typeof value.lastLog === "string" ? value.lastLog : null,
    lastLogLevel: typeof lastLogLevel === "string" ? lastLogLevel : null,
    uptimeSeconds: typeof value.uptimeSeconds === "number" ? value.uptimeSeconds : null,
    memoryUsage: value.memoryUsage === null || value.memoryUsage === undefined
      ? null
      : parseRemoteVmInspectorWorkerMemoryUsage(value.memoryUsage),
  };
}

function parseRemoteVmInspectorSnapshot(value: unknown): RemoteVmInspectorSnapshot | null {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.notebookCellCount !== "number" || typeof value.inspectedAt !== "string" || typeof value.snapshotPath !== "string") {
    return null;
  }

  const memoryUsage = parseRemoteVmInspectorMemoryUsage(value.memoryUsage);
  const vm = parseRemoteVmInspectorVmState(value.vm);
  const execution = isRecord(value.execution)
    ? {
      activeTaskId: typeof value.execution.activeTaskId === "string" ? value.execution.activeTaskId : null,
      queueLength: typeof value.execution.queueLength === "number" ? value.execution.queueLength : 0,
      tasks: Array.isArray(value.execution.tasks)
        ? value.execution.tasks
          .map(parseRemoteVmExecutionTask)
          .filter((entry): entry is RemoteVmExecutionTask => Boolean(entry))
        : [],
    }
    : { activeTaskId: null, queueLength: 0, tasks: [] };
  if (!memoryUsage || !vm || !Array.isArray(value.recentCellResults) || !Array.isArray(value.runtimeKits) || !Array.isArray(value.backgroundWorkers)) {
    return null;
  }

  return {
    code: value.code,
    relativePath: typeof value.relativePath === "string" ? value.relativePath : null,
    notebookTitle: typeof value.notebookTitle === "string" ? value.notebookTitle : null,
    notebookCellCount: value.notebookCellCount,
    inspectedAt: value.inspectedAt,
    snapshotPath: value.snapshotPath,
    activeEvaluation: value.activeEvaluation === null || value.activeEvaluation === undefined
      ? null
      : parseRemoteVmInspectorActiveEvaluation(value.activeEvaluation),
    execution,
    memoryUsage,
    vm,
    recentCellResults: value.recentCellResults
      .map(parseRemoteVmInspectorCellResult)
      .filter((entry): entry is RemoteVmInspectorCellResult => Boolean(entry)),
    runtimeKits: value.runtimeKits
      .map(parseRemoteVmInspectorRuntimeKit)
      .filter((entry): entry is RemoteVmInspectorRuntimeKit => Boolean(entry)),
    backgroundWorkers: value.backgroundWorkers
      .map(parseRemoteVmInspectorWorker)
      .filter((entry): entry is RemoteVmInspectorWorker => Boolean(entry)),
  };
}

function parseRemoteVmExecutionTask(value: unknown): RemoteVmExecutionTask | null {
  if (!isRecord(value) || typeof value.taskId !== "string" || typeof value.code !== "string" || typeof value.status !== "string" || typeof value.queuedAt !== "string" || typeof value.sourcePreview !== "string" || typeof value.sourceLineCount !== "number" || typeof value.cancelRequested !== "boolean" || typeof value.queueLength !== "number") {
    return null;
  }

  const status = value.status;
  if (status !== "queued" && status !== "running" && status !== "completed" && status !== "failed" && status !== "cancelled") {
    return null;
  }

  const logs = parseRemoteStringArray(value.logs);

  return {
    taskId: value.taskId,
    code: value.code,
    language: value.language === "sql" ? "sql" : "javascript",
    cellId: typeof value.cellId === "string" ? value.cellId : null,
    previousCellId: typeof value.previousCellId === "string" ? value.previousCellId : null,
    status,
    queuedAt: value.queuedAt,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
    sourcePreview: value.sourcePreview,
    sourceLineCount: value.sourceLineCount,
    cancelRequested: value.cancelRequested,
    queuePosition: typeof value.queuePosition === "number" ? value.queuePosition : null,
    queueLength: value.queueLength,
    logs,
    logLineCount: typeof value.logLineCount === "number" ? value.logLineCount : logs.length,
  };
}

function parseRemoteVmExecutionStreamEvent(value: unknown): Exclude<RemoteVmExecutionStreamEvent, RemoteVmExecutionOutputEvent> | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "ready") {
    return { type: "ready" };
  }

  if ((value.type === "queued" || value.type === "queue" || value.type === "started" || value.type === "complete") && value.task !== undefined) {
    const task = parseRemoteVmExecutionTask(value.task);
    if (!task) {
      return null;
    }

    return value.type === "queued"
      ? { type: "queued", task }
      : value.type === "queue"
        ? { type: "queue", task }
        : value.type === "started"
          ? { type: "started", task }
          : { type: "complete", task };
  }

  if (value.type === "result" && typeof value.taskId === "string") {
    return {
      type: "result",
      taskId: value.taskId,
      result: value.result,
    };
  }

  if (value.type === "error" && typeof value.taskId === "string" && typeof value.error === "string") {
    return {
      type: "error",
      taskId: value.taskId,
      error: value.error,
    };
  }

  if (value.type === "cancelled" && value.task !== undefined && typeof value.reason === "string") {
    const task = parseRemoteVmExecutionTask(value.task);
    if (!task) {
      return null;
    }

    return {
      type: "cancelled",
      task,
      reason: value.reason,
    };
  }

  if (value.type === "cancel-ack" && typeof value.taskId === "string" && typeof value.accepted === "boolean" && typeof value.status === "string") {
    const status = value.status;
    if (status !== "queued" && status !== "running" && status !== "completed" && status !== "failed" && status !== "cancelled" && status !== "unknown") {
      return null;
    }

    return {
      type: "cancel-ack",
      taskId: value.taskId,
      accepted: value.accepted,
      status,
      message: typeof value.message === "string" ? value.message : undefined,
    };
  }

  return null;
}

function parseRemoteVmInspectorStreamEvent(value: unknown): RemoteVmInspectorStreamEvent | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "ready") {
    return { type: "ready" };
  }

  if (value.type === "error" && typeof value.error === "string") {
    return {
      type: "error",
      error: value.error,
    };
  }

  if (value.type === "node-error" && typeof value.handle === "string" && typeof value.error === "string") {
    return {
      type: "node-error",
      handle: value.handle,
      error: value.error,
    };
  }

  if (value.type === "cancel-ack" && typeof value.taskId === "string" && typeof value.accepted === "boolean" && typeof value.status === "string") {
    const status = value.status;
    if (status !== "queued" && status !== "running" && status !== "completed" && status !== "failed" && status !== "cancelled" && status !== "unknown") {
      return null;
    }

    return {
      type: "cancel-ack",
      taskId: value.taskId,
      accepted: value.accepted,
      status,
      message: typeof value.message === "string" ? value.message : undefined,
    };
  }

  if (value.type === "node" && typeof value.handle === "string") {
    const details = parseRemoteVmInspectorNodeDetails(value.details);
    if (!details) {
      return null;
    }

    return {
      type: "node",
      handle: value.handle,
      details,
    };
  }

  if (value.type === "state" && Array.isArray(value.rootGroups)) {
    const snapshot = parseRemoteVmInspectorSnapshot(value.snapshot);
    if (!snapshot) {
      return null;
    }

    return {
      type: "state",
      snapshot,
      rootGroups: value.rootGroups
        .map(parseRemoteVmInspectorRootGroup)
        .filter((entry): entry is RemoteVmInspectorRootGroup => Boolean(entry)),
    };
  }

  return null;
}

const REMOTE_VM_EXECUTION_BINARY_KIND_STDOUT = 3;
const REMOTE_VM_EXECUTION_BINARY_KIND_STDERR = 4;

function parseRemotePortScanSelectionMode(value: unknown): RemotePortScanSelectionMode | null {
  return value === "ports" || value === "topPorts"
    ? value
    : null;
}

function parseRemoteNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
}

function parseRemoteStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseRemotePortScanResult(value: unknown): RemotePortScanResult | null {
  if (!isRecord(value) || typeof value.host !== "string") {
    return null;
  }

  const selectionMode = parseRemotePortScanSelectionMode(value.selectionMode);
  if (!selectionMode) {
    return null;
  }

  return {
    host: value.host,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : "",
    durationMs: typeof value.durationMs === "number" ? value.durationMs : 0,
    ports: typeof value.ports === "string" ? value.ports : null,
    topPorts: typeof value.topPorts === "number" ? value.topPorts : null,
    selectionMode,
    concurrency: typeof value.concurrency === "number" ? value.concurrency : 0,
    connectTimeoutMs: typeof value.connectTimeoutMs === "number" ? value.connectTimeoutMs : 0,
    scannedPortCount: typeof value.scannedPortCount === "number" ? value.scannedPortCount : 0,
    openPorts: parseRemoteNumberArray(value.openPorts),
    openPortCount: typeof value.openPortCount === "number" ? value.openPortCount : 0,
    errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : null,
    persisted: value.persisted === true,
    scanId: typeof value.scanId === "string" ? value.scanId : null,
  };
}

function parseRemotePortScanSavedScan(value: unknown): RemotePortScanSavedScan | null {
  const result = parseRemotePortScanResult(value);
  if (!result || result.persisted !== true || typeof result.scanId !== "string") {
    return null;
  }

  return {
    ...result,
    persisted: true,
    scanId: result.scanId,
  };
}

function parseRemotePortScanPolicySnapshot(value: unknown): RemotePortScanPolicySnapshot | null {
  if (!isRecord(value) || !isRecord(value.policy) || !isRecord(value.defaults) || !isRecord(value.examples)) {
    return null;
  }

  return {
    policy: {
      allowHosts: parseRemoteStringArray(value.policy.allowHosts),
      denyHosts: parseRemoteStringArray(value.policy.denyHosts),
      allowPrivateAddresses: value.policy.allowPrivateAddresses === true,
      allowLoopback: value.policy.allowLoopback === true,
      denyPublicAddresses: value.policy.denyPublicAddresses === true,
    },
    defaults: {
      topPorts: typeof value.defaults.topPorts === "number" ? value.defaults.topPorts : 0,
      concurrency: typeof value.defaults.concurrency === "number" ? value.defaults.concurrency : 0,
      connectTimeoutMs: typeof value.defaults.connectTimeoutMs === "number" ? value.defaults.connectTimeoutMs : 0,
    },
    maxTopPorts: typeof value.maxTopPorts === "number" ? value.maxTopPorts : 0,
    topPortsPreview: parseRemoteNumberArray(value.topPortsPreview),
    examples: {
      scan: parseRemoteStringArray(value.examples.scan),
      list: parseRemoteStringArray(value.examples.list),
      get: parseRemoteStringArray(value.examples.get),
    },
  };
}

function parseRemoteAuditCrawlSeverity(value: unknown): RemoteAuditCrawlSeverity | null {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : null;
}

function parseRemoteAuditCrawlResourceKind(value: unknown): RemoteAuditCrawlResourceKind | null {
  switch (value) {
    case "document":
    case "script":
    case "style":
    case "modulepreload":
    case "fetch":
    case "xhr":
    case "image":
    case "font":
    case "media":
    case "manifest":
    case "source-map":
    case "source-file":
    case "other":
      return value;
    default:
      return null;
  }
}

function parseRemoteAuditCrawlDiscoveryKind(value: unknown): RemoteAuditCrawlDiscoveryKind | null {
  switch (value) {
    case "document":
    case "html":
    case "network":
    case "sourcemap":
    case "bundle-import":
      return value;
    default:
      return null;
  }
}

function parseRemoteAuditCrawlEdgeKind(value: unknown): RemoteAuditCrawlEdgeKind | null {
  switch (value) {
    case "loads":
    case "imports":
    case "references-source-map":
    case "contains-source":
      return value;
    default:
      return null;
  }
}

function parseRemoteAuditCrawlFinding(value: unknown): RemoteAuditCrawlFinding | null {
  if (!isRecord(value)) {
    return null;
  }

  const severity = parseRemoteAuditCrawlSeverity(value.severity);
  if (!severity || typeof value.kind !== "string" || typeof value.location !== "string" || typeof value.evidence !== "string" || typeof value.message !== "string") {
    return null;
  }

  return {
    severity,
    kind: value.kind,
    location: value.location,
    evidence: value.evidence,
    rawEvidence: typeof value.rawEvidence === "string" ? value.rawEvidence : undefined,
    message: value.message,
    resourceId: typeof value.resourceId === "string" ? value.resourceId : undefined,
  };
}

function parseRemoteAuditCrawlResourceNode(value: unknown): RemoteAuditCrawlResourceNode | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.url !== "string" || typeof value.label !== "string" || typeof value.status !== "string") {
    return null;
  }

  const kind = parseRemoteAuditCrawlResourceKind(value.kind);
  const discoveredBy = parseRemoteAuditCrawlDiscoveryKind(value.discoveredBy);
  if (!kind || !discoveredBy || typeof value.sameOrigin !== "boolean" || typeof value.scanned !== "boolean" || typeof value.isDynamic !== "boolean" || typeof value.hasSourceMap !== "boolean") {
    return null;
  }

  return {
    id: value.id,
    kind,
    url: value.url,
    label: value.label,
    status: value.status,
    discoveredBy,
    sameOrigin: value.sameOrigin,
    scanned: value.scanned,
    isDynamic: value.isDynamic,
    contentType: typeof value.contentType === "string" ? value.contentType : undefined,
    bytes: typeof value.bytes === "number" ? value.bytes : undefined,
    parentUrl: typeof value.parentUrl === "string" ? value.parentUrl : undefined,
    initiatorUrl: typeof value.initiatorUrl === "string" ? value.initiatorUrl : undefined,
    note: typeof value.note === "string" ? value.note : undefined,
    hasSourceMap: value.hasSourceMap,
    sourceMapUrl: typeof value.sourceMapUrl === "string" ? value.sourceMapUrl : undefined,
  };
}

function parseRemoteAuditCrawlEdge(value: unknown): RemoteAuditCrawlEdge | null {
  if (!isRecord(value) || typeof value.from !== "string" || typeof value.to !== "string") {
    return null;
  }

  const kind = parseRemoteAuditCrawlEdgeKind(value.kind);
  if (!kind) {
    return null;
  }

  return {
    from: value.from,
    to: value.to,
    kind,
    note: typeof value.note === "string" ? value.note : undefined,
  };
}

function parseRemoteAuditCrawlStats(value: unknown): RemoteAuditCrawlStats | null {
  if (!isRecord(value)) {
    return null;
  }

  const values = [
    value.resourcesDiscovered,
    value.resourcesScanned,
    value.resourcesSkipped,
    value.inlineScriptsScanned,
    value.sourceMapsDiscovered,
    value.sourceMapsFetched,
    value.externalResources,
    value.dynamicResources,
  ];

  if (values.some((entry) => typeof entry !== "number")) {
    return null;
  }

  return {
    resourcesDiscovered: value.resourcesDiscovered as number,
    resourcesScanned: value.resourcesScanned as number,
    resourcesSkipped: value.resourcesSkipped as number,
    inlineScriptsScanned: value.inlineScriptsScanned as number,
    sourceMapsDiscovered: value.sourceMapsDiscovered as number,
    sourceMapsFetched: value.sourceMapsFetched as number,
    externalResources: value.externalResources as number,
    dynamicResources: value.dynamicResources as number,
  };
}

function parseRemoteAuditCrawlResult(value: unknown): RemoteAuditCrawlResult | null {
  if (!isRecord(value) || typeof value.url !== "string" || typeof value.auditedAt !== "string" || typeof value.entryResourceId !== "string" || !Array.isArray(value.findings) || !Array.isArray(value.resources) || !Array.isArray(value.edges)) {
    return null;
  }

  const stats = parseRemoteAuditCrawlStats(value.stats);
  if (!stats) {
    return null;
  }

  return {
    url: value.url,
    auditedAt: value.auditedAt,
    entryResourceId: value.entryResourceId,
    findings: value.findings
      .map((entry) => parseRemoteAuditCrawlFinding(entry))
      .filter((entry): entry is RemoteAuditCrawlFinding => Boolean(entry)),
    resources: value.resources
      .map((entry) => parseRemoteAuditCrawlResourceNode(entry))
      .filter((entry): entry is RemoteAuditCrawlResourceNode => Boolean(entry)),
    edges: value.edges
      .map((entry) => parseRemoteAuditCrawlEdge(entry))
      .filter((entry): entry is RemoteAuditCrawlEdge => Boolean(entry)),
    stats,
  };
}

function parseJsonText(value: unknown): unknown {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseRemoteHttpClientFieldEntries(value: unknown): RemoteHttpClientFieldEntry[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry, index) => ({
        id: typeof entry.id === "string" && entry.id.trim().length > 0 ? entry.id : `field-${index}`,
        key: typeof entry.key === "string" ? entry.key : "",
        value: typeof entry.value === "string" ? entry.value : "",
        enabled: entry.enabled !== false,
      }));
  }

  if (isRecord(value)) {
    return Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, fieldValue], index) => ({
        id: `field-${index}`,
        key,
        value: fieldValue,
        enabled: true,
      }));
  }

  return [];
}

function parseRemoteHttpClientResponseSnapshot(value: Record<string, unknown>): RemoteHttpClientResponseSnapshot | null {
  const hasSnapshot = [
    value.last_status_code,
    value.last_duration_ms,
    value.last_response_headers_json,
    value.last_response_body_preview,
    value.last_response_content_type,
    value.last_response_size_bytes,
    value.last_executed_at,
  ].some((entry) => entry !== undefined && entry !== null && entry !== "");

  if (!hasSnapshot) {
    return null;
  }

  return {
    statusCode: typeof value.last_status_code === "number" ? value.last_status_code : null,
    durationMs: typeof value.last_duration_ms === "number" ? value.last_duration_ms : null,
    responseHeaders: parseRemoteStringRecord(parseJsonText(value.last_response_headers_json)),
    responseBodyPreview: typeof value.last_response_body_preview === "string" ? value.last_response_body_preview : null,
    responseContentType: typeof value.last_response_content_type === "string" ? value.last_response_content_type : null,
    responseSizeBytes: typeof value.last_response_size_bytes === "number" ? value.last_response_size_bytes : null,
    executedAt: typeof value.last_executed_at === "string" ? value.last_executed_at : null,
  };
}

function parseRemoteSavedHttpClientRequest(value: unknown): RemoteSavedHttpClientRequest | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    method: typeof value.method === "string" ? value.method : "GET",
    url: typeof value.url === "string" ? value.url : "",
    headers: parseRemoteHttpClientFieldEntries(parseJsonText(value.headers_json)),
    query: parseRemoteHttpClientFieldEntries(parseJsonText(value.query_json)),
    bodyText: typeof value.body_text === "string" ? value.body_text : null,
    bodyKind: typeof value.body_kind === "string" ? value.body_kind : null,
    lastResponseSnapshot: parseRemoteHttpClientResponseSnapshot(value),
    createdAt: typeof value.created_at === "string" ? value.created_at : "",
    updatedAt: typeof value.updated_at === "string" ? value.updated_at : "",
  };
}

function parseRemoteHttpClientExecuteResult(value: unknown): RemoteHttpClientExecuteResult | null {
  if (!isRecord(value) || !isRecord(value.request)) {
    return null;
  }

  return {
    request: {
      method: typeof value.request.method === "string" ? value.request.method : "GET",
      url: typeof value.request.url === "string" ? value.request.url : "",
      headers: parseRemoteStringRecord(value.request.headers),
      bodyText: typeof value.request.bodyText === "string" ? value.request.bodyText : null,
      timeoutMs: typeof value.request.timeoutMs === "number" ? value.request.timeoutMs : 0,
    },
    response: isRecord(value.response)
      ? {
        ok: value.response.ok === true,
        status: typeof value.response.status === "number" ? value.response.status : 0,
        statusText: typeof value.response.statusText === "string" ? value.response.statusText : "",
        headers: parseRemoteStringRecord(value.response.headers),
        contentType: typeof value.response.contentType === "string" ? value.response.contentType : null,
        bodyText: typeof value.response.bodyText === "string" ? value.response.bodyText : null,
        bodyPreview: typeof value.response.bodyPreview === "string" ? value.response.bodyPreview : null,
        sizeBytes: typeof value.response.sizeBytes === "number" ? value.response.sizeBytes : 0,
        durationMs: typeof value.response.durationMs === "number" ? value.response.durationMs : 0,
      }
      : null,
    error: isRecord(value.error)
      ? {
        code: typeof value.error.code === "string" ? value.error.code : null,
        message: typeof value.error.message === "string" ? value.error.message : "Unknown request error.",
      }
      : null,
  };
}

function parseRemoteImportedCurlRequest(value: unknown): RemoteImportedCurlRequest | null {
  if (!isRecord(value) || typeof value.method !== "string" || typeof value.url !== "string") {
    return null;
  }

  return {
    method: value.method,
    url: value.url,
    headers: parseRemoteStringRecord(value.headers),
    bodyText: typeof value.bodyText === "string" ? value.bodyText : null,
    timeoutMs: typeof value.timeoutMs === "number" ? value.timeoutMs : 0,
  };
}

function parseRemoteZoomEyeHostEntry(value: unknown): RemoteZoomEyeHostEntry | null {
  if (!isRecord(value) || typeof value.ip !== "string" || typeof value.port !== "number" || typeof value.last_pulled_at !== "string") {
    return null;
  }

  return {
    ip: value.ip,
    port: value.port,
    queryText: typeof value.query_text === "string" ? value.query_text : null,
    service: typeof value.service === "string" ? value.service : null,
    transport: typeof value.transport === "string" ? value.transport : null,
    product: typeof value.product === "string" ? value.product : null,
    hostname: typeof value.hostname === "string" ? value.hostname : null,
    os: typeof value.os === "string" ? value.os : null,
    title: typeof value.title === "string" ? value.title : null,
    body: typeof value.body === "string" ? value.body : null,
    header: typeof value.header === "string" ? value.header : null,
    banner: typeof value.banner === "string" ? value.banner : null,
    organization: typeof value.organization === "string" ? value.organization : null,
    countryCode: typeof value.country_code === "string" ? value.country_code : null,
    countryNameEn: typeof value.country_name_en === "string" ? value.country_name_en : null,
    lastPulledAt: value.last_pulled_at,
  };
}

function parseRemoteZoomEyePullSummary(value: unknown): RemoteZoomEyePullSummary | null {
  if (!isRecord(value) || typeof value.authenticatedUser !== "string" || typeof value.cloakProfileId !== "string" || typeof value.cloakProfileLabel !== "string") {
    return null;
  }

  return {
    authenticatedUser: value.authenticatedUser,
    cloakProfileId: value.cloakProfileId,
    cloakProfileLabel: value.cloakProfileLabel,
    inserted: typeof value.inserted === "number" ? value.inserted : 0,
    maxResults: typeof value.maxResults === "number" ? value.maxResults : 0,
    pageSize: typeof value.pageSize === "number" ? value.pageSize : 0,
    pagesFetched: typeof value.pagesFetched === "number" ? value.pagesFetched : 0,
    rawMatches: typeof value.rawMatches === "number" ? value.rawMatches : 0,
    requestedCloakProfileId: typeof value.requestedCloakProfileId === "string" ? value.requestedCloakProfileId : null,
    startPage: typeof value.startPage === "number" ? value.startPage : 0,
    uniqueMatches: typeof value.uniqueMatches === "number" ? value.uniqueMatches : 0,
    updated: typeof value.updated === "number" ? value.updated : 0,
  };
}

function parseRemoteZoomEyePullResult(value: unknown): RemoteZoomEyePullResult | null {
  if (!isRecord(value) || typeof value.queryBase64 !== "string" || typeof value.searchType !== "string" || typeof value.fetchedAt !== "string") {
    return null;
  }

  const summary = parseRemoteZoomEyePullSummary(value.summary);
  if (!summary) {
    return null;
  }

  return {
    queryBase64: value.queryBase64,
    queryText: typeof value.queryText === "string" ? value.queryText : null,
    searchType: value.searchType,
    fetchedAt: value.fetchedAt,
    summary,
    entries: Array.isArray(value.entries)
      ? value.entries
        .map((entry) => parseRemoteZoomEyeHostEntry(entry))
        .filter((entry): entry is RemoteZoomEyeHostEntry => Boolean(entry))
      : [],
  };
}

function parseRemoteZoomEyePassiveCaptureEvent(value: unknown): RemoteZoomEyePassiveCaptureEvent | null {
  if (
    !isRecord(value)
    || typeof value.capturedAt !== "string"
    || typeof value.requestUrl !== "string"
    || typeof value.method !== "string"
    || typeof value.resourceType !== "string"
    || typeof value.status !== "number"
    || typeof value.queryBase64 !== "string"
    || typeof value.searchType !== "string"
    || typeof value.page !== "number"
    || typeof value.pageSize !== "number"
    || typeof value.rawMatches !== "number"
    || typeof value.uniqueMatches !== "number"
    || typeof value.inserted !== "number"
    || typeof value.updated !== "number"
  ) {
    return null;
  }

  return {
    capturedAt: value.capturedAt,
    errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : null,
    pageId: typeof value.pageId === "string" ? value.pageId : null,
    pageUrl: typeof value.pageUrl === "string" ? value.pageUrl : null,
    requestUrl: value.requestUrl,
    method: value.method,
    resourceType: value.resourceType,
    status: value.status,
    queryBase64: value.queryBase64,
    queryText: typeof value.queryText === "string" ? value.queryText : null,
    searchType: value.searchType,
    page: value.page,
    pageSize: value.pageSize,
    rawMatches: value.rawMatches,
    uniqueMatches: value.uniqueMatches,
    inserted: value.inserted,
    updated: value.updated,
  };
}

function parseRemoteZoomEyePassiveCaptureSession(value: unknown): RemoteZoomEyePassiveCaptureSession | null {
  if (
    !isRecord(value)
    || typeof value.captureId !== "string"
    || typeof value.active !== "boolean"
    || typeof value.profileRunning !== "boolean"
    || typeof value.cloakProfileId !== "string"
    || typeof value.cloakProfileLabel !== "string"
    || typeof value.startedAt !== "string"
    || typeof value.totalCaptured !== "number"
  ) {
    return null;
  }

  return {
    captureId: value.captureId,
    active: value.active,
    profileRunning: value.profileRunning,
    cloakProfileId: value.cloakProfileId,
    cloakProfileLabel: value.cloakProfileLabel,
    startedAt: value.startedAt,
    lastCapturedAt: typeof value.lastCapturedAt === "string" ? value.lastCapturedAt : null,
    currentUrl: typeof value.currentUrl === "string" ? value.currentUrl : null,
    totalCaptured: value.totalCaptured,
    recentEvents: Array.isArray(value.recentEvents)
      ? value.recentEvents
        .map((event) => parseRemoteZoomEyePassiveCaptureEvent(event))
        .filter((event): event is RemoteZoomEyePassiveCaptureEvent => Boolean(event))
      : [],
  };
}

function parseRemoteZoomEyeHostDetail(value: unknown): RemoteZoomEyeHostDetail | null {
  if (
    !isRecord(value)
    || typeof value.id !== "number"
    || typeof value.ip !== "string"
    || typeof value.port !== "number"
    || typeof value.query_base64 !== "string"
    || typeof value.search_type !== "string"
    || typeof value.page_size !== "number"
    || typeof value.first_pulled_at !== "string"
    || typeof value.last_pulled_at !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    ip: value.ip,
    port: value.port,
    queryBase64: value.query_base64,
    queryText: typeof value.query_text === "string" ? value.query_text : null,
    searchType: value.search_type,
    pageSize: value.page_size,
    matchType: typeof value.match_type === "string" ? value.match_type : null,
    service: typeof value.service === "string" ? value.service : null,
    transport: typeof value.transport === "string" ? value.transport : null,
    product: typeof value.product === "string" ? value.product : null,
    hostname: typeof value.hostname === "string" ? value.hostname : null,
    os: typeof value.os === "string" ? value.os : null,
    title: typeof value.title === "string" ? value.title : null,
    extraInfo: typeof value.extra_info === "string" ? value.extra_info : null,
    body: typeof value.body === "string" ? value.body : null,
    header: typeof value.header === "string" ? value.header : null,
    banner: typeof value.banner === "string" ? value.banner : null,
    token: typeof value.token === "string" ? value.token : null,
    qid: typeof value.qid === "string" ? value.qid : null,
    zoomeyeTimestamp: typeof value.zoomeye_timestamp === "string" ? value.zoomeye_timestamp : null,
    countryCode: typeof value.country_code === "string" ? value.country_code : null,
    countryNameEn: typeof value.country_name_en === "string" ? value.country_name_en : null,
    countryNameCn: typeof value.country_name_cn === "string" ? value.country_name_cn : null,
    cityNameEn: typeof value.city_name_en === "string" ? value.city_name_en : null,
    cityNameCn: typeof value.city_name_cn === "string" ? value.city_name_cn : null,
    subdivisionNameEn: typeof value.subdivision_name_en === "string" ? value.subdivision_name_en : null,
    subdivisionNameCn: typeof value.subdivision_name_cn === "string" ? value.subdivision_name_cn : null,
    organization: typeof value.organization === "string" ? value.organization : null,
    asn: typeof value.asn === "string" ? value.asn : null,
    firstPulledAt: value.first_pulled_at,
    lastPulledAt: value.last_pulled_at,
    raw: isRecord(parseJsonText(value.raw_json)) ? parseJsonText(value.raw_json) as Record<string, unknown> : null,
  };
}

function buildApiError(message: string, status?: number): Error {
  const error = new Error(message);
  if (status !== undefined) {
    (error as Error & { status?: number }).status = status;
  }
  return error;
}

function buildExecutionStreamTransportError(message: string): Error {
  const error = new Error(message) as Error & { fallbackToHttp?: boolean };
  error.fallbackToHttp = true;
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

export async function listRemoteCommandPaletteCommands(): Promise<RemoteCommandPaletteCommand[]> {
  const payload = await apiRequest<{ commands?: RemoteCommandPaletteCommand[] }>("/vm/commands", {
    method: "GET",
  });

  if (!Array.isArray(payload.result?.commands)) {
    throw buildApiError("Command palette payload is incomplete.");
  }

  return payload.result.commands;
}

export async function runRemoteCommandPaletteCommand(
  id: string,
  params?: unknown,
  init?: RequestInit,
): Promise<RemoteCommandPaletteRunResult> {
  const payload = await apiRequest<RemoteCommandPaletteRunResult>("/vm/commands/run", {
    method: "POST",
    body: JSON.stringify({ id, params }),
    ...init,
  });

  if (typeof payload.result?.commandId !== "string" || typeof payload.result.durationMs !== "number") {
    throw buildApiError("Command palette run payload is incomplete.");
  }

  return payload.result;
}

export async function getRemoteSettingsCatalog(): Promise<RemoteSettingsCatalog> {
  const payload = await apiRequest<RemoteSettingsCatalog>("/vm/settings", {
    method: "GET",
  });

  if (!payload.result || !Array.isArray(payload.result.groups) || !Array.isArray(payload.result.settings)) {
    throw buildApiError("Settings catalog payload is incomplete.");
  }

  return payload.result;
}

export async function setRemoteSettingValue(id: string, value: unknown): Promise<RemoteResolvedSettingValue> {
  const payload = await apiRequest<{ value?: RemoteResolvedSettingValue }>("/vm/settings/set", {
    method: "POST",
    body: JSON.stringify({ id, value }),
  });

  if (!payload.result?.value) {
    throw buildApiError("Settings set payload is incomplete.");
  }

  return payload.result.value;
}

export async function resetRemoteSettingValue(id: string): Promise<{ id: string; deleted: boolean; value: RemoteResolvedSettingValue }> {
  const payload = await apiRequest<{ id?: string; deleted?: boolean; value?: RemoteResolvedSettingValue }>("/vm/settings/reset", {
    method: "POST",
    body: JSON.stringify({ id }),
  });

  if (typeof payload.result?.id !== "string" || typeof payload.result?.deleted !== "boolean" || !payload.result?.value) {
    throw buildApiError("Settings reset payload is incomplete.");
  }

  return {
    id: payload.result.id,
    deleted: payload.result.deleted,
    value: payload.result.value,
  };
}

export async function runRemoteAuditCrawl(
  input: RemoteAuditCrawlParams,
  init?: RequestInit,
): Promise<RemoteAuditCrawlResult> {
  const payload = await apiRequest<unknown>("/vm/audit/crawl", {
    method: "POST",
    body: JSON.stringify(input),
    ...init,
  });

  const result = parseRemoteAuditCrawlResult(payload.result);
  if (!result) {
    throw buildApiError("Crawl audit payload is incomplete.");
  }

  return result;
}

export async function searchRemoteExploitEntries(
  query: string,
  limit: number = 10,
  init?: RequestInit,
): Promise<RemoteExploitEntry[]> {
  const result = await runRemoteCommandPaletteCommand(
    "kits/exploitdb/search",
    { query, limit },
    init,
  );

  if (!isRecord(result.result) || !Array.isArray(result.result.entries)) {
    throw buildApiError("Exploit search payload is incomplete.");
  }

  return result.result.entries
    .map((entry) => parseRemoteExploitEntry(entry))
    .filter((entry): entry is RemoteExploitEntry => Boolean(entry));
}

export async function getRemoteExploitViewerData(
  exploitId: string,
  init?: RequestInit,
): Promise<RemoteExploitViewerData> {
  const result = await runRemoteCommandPaletteCommand(
    "kits/exploitdb/get",
    { exploitId },
    init,
  );

  if (!isRecord(result.result)) {
    throw buildApiError("Exploit detail payload is incomplete.");
  }

  return {
    entry: parseRemoteExploitEntry(result.result.entry),
    raw: parseRemoteExploitRaw(result.result.raw),
  };
}

export async function getRemotePortScanPolicy(
  init?: RequestInit,
): Promise<RemotePortScanPolicySnapshot> {
  const result = await runRemoteCommandPaletteCommand("kits/portScan/policy", undefined, init);
  const snapshot = parseRemotePortScanPolicySnapshot(result.result);
  if (!snapshot) {
    throw buildApiError("Port scan policy payload is incomplete.");
  }

  return snapshot;
}

export async function runRemotePortScan(
  input: {
    host: string;
    ports?: string | null;
    topPorts?: number | null;
    concurrency?: number | null;
    connectTimeoutMs?: number | null;
    persist?: boolean | null;
  },
  init?: RequestInit,
): Promise<RemotePortScanResult> {
  const result = await runRemoteCommandPaletteCommand("kits/portScan/scan", input, init);
  const scan = parseRemotePortScanResult(result.result);
  if (!scan) {
    throw buildApiError("Port scan payload is incomplete.");
  }

  return scan;
}

export async function listRemotePortScans(
  options: {
    host?: string | null;
    limit?: number | null;
    offset?: number | null;
  } = {},
  init?: RequestInit,
): Promise<RemotePortScanSavedScan[]> {
  const result = await runRemoteCommandPaletteCommand("kits/portScan/list", options, init);
  if (!isRecord(result.result) || !Array.isArray(result.result.scans)) {
    throw buildApiError("Port scan history payload is incomplete.");
  }

  return result.result.scans
    .map((entry) => parseRemotePortScanSavedScan(entry))
    .filter((entry): entry is RemotePortScanSavedScan => Boolean(entry));
}

export async function getRemotePortScan(
  scanId: string,
  init?: RequestInit,
): Promise<RemotePortScanSavedScan | null> {
  const result = await runRemoteCommandPaletteCommand("kits/portScan/get", { scanId }, init);
  if (!isRecord(result.result)) {
    throw buildApiError("Port scan detail payload is incomplete.");
  }

  if (result.result.scan === null || result.result.scan === undefined) {
    return null;
  }

  const scan = parseRemotePortScanSavedScan(result.result.scan);
  if (!scan) {
    throw buildApiError("Port scan detail payload is incomplete.");
  }

  return scan;
}

export async function executeRemoteHttpClientRequest(
  input: RemoteHttpClientExecuteRequestInput,
  init?: RequestInit,
): Promise<RemoteHttpClientExecuteResult> {
  const payload = await apiRequest<{ result?: unknown }>("/vm/http-client/execute", {
    method: "POST",
    body: JSON.stringify(input),
    ...init,
  });

  const result = parseRemoteHttpClientExecuteResult(payload.result);
  if (!result) {
    throw buildApiError("HTTP client execute payload is incomplete.");
  }

  return result;
}

export async function importRemoteCurlRequest(
  curl: string,
  init?: RequestInit,
): Promise<RemoteImportedCurlRequest> {
  const payload = await apiRequest<{ request?: unknown }>("/vm/http-client/import-curl", {
    method: "POST",
    body: JSON.stringify({ curl }),
    ...init,
  });

  const result = parseRemoteImportedCurlRequest(payload.result?.request);
  if (!result) {
    throw buildApiError("Curl import payload is incomplete.");
  }

  return result;
}

export async function listRemoteSavedHttpClientRequests(
  options: { limit?: number; offset?: number } = {},
  init?: RequestInit,
): Promise<RemoteSavedHttpClientRequest[]> {
  const url = new URL(`${API_PREFIX}/vm/http-client/requests`, window.location.origin);
  if (typeof options.limit === "number") {
    url.searchParams.set("limit", String(options.limit));
  }
  if (typeof options.offset === "number") {
    url.searchParams.set("offset", String(options.offset));
  }

  const response = await fetch(url.pathname + url.search, {
    method: "GET",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await readApiEnvelope<{ requests?: unknown[] }>(response);

  if (!Array.isArray(payload.result?.requests)) {
    throw buildApiError("Saved HTTP client requests payload is incomplete.");
  }

  return payload.result.requests
    .map((request) => parseRemoteSavedHttpClientRequest(request))
    .filter((request): request is RemoteSavedHttpClientRequest => Boolean(request));
}

export async function getRemoteSavedHttpClientRequest(
  id: string,
  init?: RequestInit,
): Promise<RemoteSavedHttpClientRequest | null> {
  const payload = await apiRequest<{ request?: unknown }>(`/vm/http-client/requests/${encodeURIComponent(id)}`, {
    method: "GET",
    ...init,
  });

  if (payload.result?.request === null || payload.result?.request === undefined) {
    return null;
  }

  const request = parseRemoteSavedHttpClientRequest(payload.result.request);
  if (!request) {
    throw buildApiError("Saved HTTP client request payload is incomplete.");
  }

  return request;
}

export async function saveRemoteHttpClientRequest(
  input: {
    id?: string;
    name: string;
    method: string;
    url: string;
    headers?: RemoteHttpClientFieldEntry[];
    query?: RemoteHttpClientFieldEntry[];
    bodyText?: string | null;
    bodyKind?: string | null;
    lastResponseSnapshot?: RemoteHttpClientResponseSnapshot | null;
  },
  init?: RequestInit,
): Promise<RemoteSavedHttpClientRequest> {
  const payload = await apiRequest<{ request?: unknown }>("/vm/http-client/requests/save", {
    method: "POST",
    body: JSON.stringify(input),
    ...init,
  });

  const request = parseRemoteSavedHttpClientRequest(payload.result?.request);
  if (!request) {
    throw buildApiError("Saved HTTP client request payload is incomplete.");
  }

  return request;
}

export async function deleteRemoteSavedHttpClientRequest(
  id: string,
  init?: RequestInit,
): Promise<boolean> {
  const payload = await apiRequest<{ deleted?: boolean }>("/vm/http-client/requests/delete", {
    method: "POST",
    body: JSON.stringify({ id }),
    ...init,
  });

  return payload.result?.deleted === true;
}

export async function listRemoteAiConnections(
  init?: RequestInit,
): Promise<RemoteAiConnectionSummary[]> {
  const payload = await apiRequest<{ connections?: unknown[] }>("/vm/kits/ai/connections", {
    method: "GET",
    ...init,
  });

  if (!Array.isArray(payload.result?.connections)) {
    throw buildApiError("AI connections payload is incomplete.");
  }

  return payload.result.connections
    .map((entry) => parseRemoteAiConnectionSummary(entry))
    .filter((entry): entry is RemoteAiConnectionSummary => Boolean(entry));
}

export async function sendRemoteAiAgentChat(
  input: {
    connectionId?: string;
    connection?: string;
    messages: RemoteAiAgentChatMessage[];
    system?: string | null;
    model?: string | null;
    temperature?: number | null;
    maxOutputTokens?: number | null;
  },
  init?: RequestInit,
): Promise<RemoteAiAgentChatResult> {
  const payload = await apiRequest<unknown>("/vm/kits/ai/agent/chat", {
    method: "POST",
    body: JSON.stringify(input),
    ...init,
  });

  const result = parseRemoteAiAgentChatResult(payload.result);
  if (!result) {
    throw buildApiError("AI agent chat payload is incomplete.");
  }

  return result;
}

export async function pullRemoteZoomEyeSearch(
  input: {
    query: string;
    cloakProfileId: string;
    searchType?: string;
    pageSize?: number;
    maxResults?: number;
    startPage?: number;
    authTimeoutMs?: number;
    expectedUserText?: string | null;
  },
  init?: RequestInit,
): Promise<RemoteZoomEyePullResult> {
  const payload = await apiRequest<{ result?: unknown }>("/vm/discovery/zoomeye/pull", {
    method: "POST",
    body: JSON.stringify(input),
    ...init,
  });

  const result = parseRemoteZoomEyePullResult(payload.result);
  if (!result) {
    throw buildApiError("ZoomEye pull payload is incomplete.");
  }

  return result;
}

export async function getRemoteZoomEyePassiveCaptureSession(
  cloakProfileId: string,
  init?: RequestInit,
): Promise<RemoteZoomEyePassiveCaptureSession | null> {
  const payload = await apiRequest<{ result?: { session?: unknown } }>(`/vm/discovery/zoomeye/capture?cloakProfileId=${encodeURIComponent(cloakProfileId)}`, {
    method: "GET",
    ...init,
  });

  if (payload.result?.session === null || payload.result?.session === undefined) {
    return null;
  }

  const session = parseRemoteZoomEyePassiveCaptureSession(payload.result.session);
  if (!session) {
    throw buildApiError("ZoomEye passive capture payload is incomplete.");
  }

  return session;
}

export async function startRemoteZoomEyePassiveCapture(
  input: {
    cloakProfileId: string;
  },
  init?: RequestInit,
): Promise<RemoteZoomEyePassiveCaptureSession> {
  const payload = await apiRequest<{ result?: { session?: unknown } }>("/vm/discovery/zoomeye/capture", {
    method: "POST",
    body: JSON.stringify(input),
    ...init,
  });

  const session = parseRemoteZoomEyePassiveCaptureSession(payload.result?.session);
  if (!session) {
    throw buildApiError("ZoomEye passive capture session payload is incomplete.");
  }

  return session;
}

export async function stopRemoteZoomEyePassiveCapture(
  input: {
    cloakProfileId: string;
  },
  init?: RequestInit,
): Promise<RemoteZoomEyePassiveCaptureSession | null> {
  const payload = await apiRequest<{ result?: { session?: unknown } }>("/vm/discovery/zoomeye/capture/stop", {
    method: "POST",
    body: JSON.stringify(input),
    ...init,
  });

  if (payload.result?.session === null || payload.result?.session === undefined) {
    return null;
  }

  const session = parseRemoteZoomEyePassiveCaptureSession(payload.result.session);
  if (!session) {
    throw buildApiError("ZoomEye passive capture stop payload is incomplete.");
  }

  return session;
}

export async function getRemoteZoomEyeHostDetail(
  ip: string,
  port: number,
  init?: RequestInit,
): Promise<RemoteZoomEyeHostDetail | null> {
  const payload = await apiRequest<{ host?: unknown }>(`/vm/discovery/zoomeye/hosts/${encodeURIComponent(ip)}/${encodeURIComponent(String(port))}`, {
    method: "GET",
    ...init,
  });

  if (payload.result?.host === null || payload.result?.host === undefined) {
    return null;
  }

  const host = parseRemoteZoomEyeHostDetail(payload.result.host);
  if (!host) {
    throw buildApiError("ZoomEye host detail payload is incomplete.");
  }

  return host;
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

export function buildRemoteBrowserAudioStreamUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${API_PREFIX}/vm/browsers/audio/stream`;
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

export function buildRemoteNotebookExecutionStreamUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${API_PREFIX}/vm/execution/stream`;
}

export function buildRemoteVmInspectorStreamUrl(code: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${API_PREFIX}/vm/${encodeURIComponent(code)}/inspector/stream`;
}

export function createRemoteVmInspectorStream(
  code: string,
  input: {
    onEvent: (event: RemoteVmInspectorStreamEvent) => void;
    onOpen?: () => void;
    onClose?: (event: CloseEvent) => void;
    onError?: (event: Event) => void;
  },
): RemoteVmInspectorStreamHandle {
  const socket = new WebSocket(buildRemoteVmInspectorStreamUrl(code));
  const pendingMessages: string[] = [];

  const flushPendingMessages = () => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    while (pendingMessages.length > 0) {
      const nextMessage = pendingMessages.shift();
      if (nextMessage !== undefined) {
        socket.send(nextMessage);
      }
    }
  };

  const sendMessage = (payload: unknown) => {
    if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
      return;
    }

    const message = JSON.stringify(payload);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
      return;
    }

    pendingMessages.push(message);
  };

  socket.addEventListener("open", () => {
    flushPendingMessages();
    input.onOpen?.();
  });

  socket.addEventListener("close", (event) => {
    input.onClose?.(event);
  });

  socket.addEventListener("error", (event) => {
    input.onError?.(event);
  });

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data) as unknown;
    } catch {
      return;
    }

    const parsedEvent = parseRemoteVmInspectorStreamEvent(parsed);
    if (parsedEvent) {
      input.onEvent(parsedEvent);
    }
  });

  return {
    socket,
    requestNode: (handle) => {
      sendMessage({
        type: "inspect-node",
        handle,
      });
    },
    cancelTask: (taskId) => {
      sendMessage({
        type: "cancel-task",
        taskId,
      });
    },
    close: () => {
      socket.close();
    },
  };
}

export function createRemoteNotebookExecutionStream(input: {
  onEvent: (event: RemoteVmExecutionStreamEvent) => void;
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
}): RemoteVmExecutionStreamHandle {
  const socket = new WebSocket(buildRemoteNotebookExecutionStreamUrl());
  socket.binaryType = "arraybuffer";
  const textDecoder = new TextDecoder();

  socket.addEventListener("open", () => {
    input.onOpen?.();
  });

  socket.addEventListener("close", (event) => {
    input.onClose?.(event);
  });

  socket.addEventListener("error", (event) => {
    input.onError?.(event);
  });

  socket.addEventListener("message", async (event) => {
    if (typeof event.data === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data) as unknown;
      } catch {
        return;
      }

      const parsedEvent = parseRemoteVmExecutionStreamEvent(parsed);
      if (parsedEvent) {
        input.onEvent(parsedEvent);
      }
      return;
    }

    const arrayBuffer = event.data instanceof ArrayBuffer
      ? event.data
      : event.data instanceof Blob
        ? await event.data.arrayBuffer()
        : null;
    if (!arrayBuffer) {
      return;
    }

    const payload = new Uint8Array(arrayBuffer);
    if (payload.length < 2) {
      return;
    }

    const kind = payload[0];
    const data = textDecoder.decode(payload.subarray(1));
    if (kind === REMOTE_VM_EXECUTION_BINARY_KIND_STDOUT || kind === REMOTE_VM_EXECUTION_BINARY_KIND_STDERR) {
      input.onEvent({
        type: "output",
        stream: kind === REMOTE_VM_EXECUTION_BINARY_KIND_STDOUT ? "stdout" : "stderr",
        data,
        isBinary: true,
      });
    }
  });

  return {
    socket,
    execute: ({ code, source, language, cellId, previousCellId }) => {
      socket.send(JSON.stringify({
        type: "execute",
        code,
        input: source,
        language,
        cellId,
        previousCellId,
      }));
    },
    cancel: (taskId) => {
      socket.send(JSON.stringify({
        type: "cancel",
        taskId,
      }));
    },
    close: () => {
      socket.close();
    },
  };
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

export async function listRemoteIsbFolders(): Promise<RemoteIsbFolderEntry[]> {
  const payload = await apiRequest<{ folders?: RemoteIsbFolderEntry[] }>("/vm/files/folders", {
    method: "GET",
  });
  return payload.result?.folders ?? [];
}

export async function createRemoteIsbFolder(relativePath: string): Promise<RemoteIsbFolderEntry> {
  const payload = await apiRequest<RemoteIsbFolderEntry>("/vm/files/folders/create", {
    method: "POST",
    body: JSON.stringify({ path: relativePath }),
  });

  if (typeof payload.result?.relativePath !== "string") {
    throw buildApiError("Notebook folder create payload is incomplete.");
  }

  return payload.result;
}

export async function searchRemoteIsbEntries(
  query: string,
  limit: number = 10,
  init?: RequestInit,
): Promise<RemoteIsbSearchEntry[]> {
  const payload = await apiRequest<{ entries?: RemoteIsbSearchEntry[] }>(`/vm/files/search?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    signal: init?.signal,
  });

  return Array.isArray(payload.result?.entries) ? payload.result.entries : [];
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

export async function searchRemoteBrowserUserAgents(query: string, limit = 8): Promise<RemoteBrowserUserAgentOption[]> {
  const searchParams = new URLSearchParams();
  searchParams.set("query", query);
  if (Number.isFinite(limit)) {
    searchParams.set("limit", String(Math.max(1, Math.round(limit))));
  }

  const payload = await apiRequest<RemoteBrowserUserAgentSearchPayload>(`/vm/browsers/user-agent-search?${searchParams.toString()}`, {
    method: "GET",
  });

  if (!Array.isArray(payload.result?.suggestions)) {
    throw buildApiError("Browser user-agent search payload is incomplete.");
  }

  return payload.result.suggestions;
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

export async function closeRemoteBrowserTab(target: string, tabId: string): Promise<{ target: string; tabId: string }> {
  const payload = await apiRequest<{ target?: string; tabId?: string }>(`/vm/browsers/${encodeURIComponent(target)}/tabs/close`, {
    method: "POST",
    body: JSON.stringify({ tabId }),
  });

  if (typeof payload.result?.target !== "string" || typeof payload.result?.tabId !== "string") {
    throw buildApiError("Browser tab close payload is incomplete.");
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

export async function insertRemoteBrowserText(target: string, text: string): Promise<{ target: string }> {
  const payload = await apiRequest<{ target?: string }>("/vm/browsers/text", {
    method: "POST",
    body: JSON.stringify({ target, text }),
  });

  if (typeof payload.result?.target !== "string") {
    throw buildApiError("Browser text payload is incomplete.");
  }

  return { target: payload.result.target };
}

export async function readRemoteBrowserSelection(target: string): Promise<{ target: string; text: string }> {
  const payload = await apiRequest<{ target?: string; text?: string }>("/vm/browsers/selection", {
    method: "POST",
    body: JSON.stringify({ target }),
  });

  if (typeof payload.result?.target !== "string" || typeof payload.result?.text !== "string") {
    throw buildApiError("Browser selection payload is incomplete.");
  }

  return {
    target: payload.result.target,
    text: payload.result.text,
  };
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
} & RemotePackageBoxPolicyInput): Promise<RemotePackageBoxEntry> {
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
} & RemotePackageBoxPolicyInput): Promise<RemotePackageBoxEntry> {
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

export async function getRemoteVmInspector(code: string): Promise<RemoteVmInspectorSnapshot> {
  const payload = await apiRequest<unknown>(`/vm/${encodeURIComponent(code)}/inspector`, {
    method: "GET",
  });

  const snapshot = parseRemoteVmInspectorSnapshot(payload.result);
  if (!snapshot) {
    throw buildApiError("VM inspector payload is incomplete.");
  }

  return snapshot;
}

export async function listRemoteVmInspectorRootGroups(code: string): Promise<RemoteVmInspectorRootGroup[]> {
  const payload = await apiRequest<{ groups?: unknown }>(`/vm/${encodeURIComponent(code)}/inspector/roots`, {
    method: "GET",
  });

  if (!Array.isArray(payload.result?.groups)) {
    throw buildApiError("VM inspector roots payload is incomplete.");
  }

  return payload.result.groups
    .map(parseRemoteVmInspectorRootGroup)
    .filter((entry): entry is RemoteVmInspectorRootGroup => Boolean(entry));
}

export async function getRemoteVmInspectorNode(
  code: string,
  handle: string,
): Promise<RemoteVmInspectorNodeDetails> {
  const payload = await apiRequest<unknown>(`/vm/${encodeURIComponent(code)}/inspector/nodes/${encodeURIComponent(handle)}`, {
    method: "GET",
  });

  const nodeDetails = parseRemoteVmInspectorNodeDetails(payload.result);
  if (!nodeDetails) {
    throw buildApiError("VM inspector node payload is incomplete.");
  }

  return nodeDetails;
}

export async function evaluateRemoteCell(
  code: string,
  source: string,
  options: { language?: RemoteNotebookCellLanguage; cellId?: string; previousCellId?: string } = {},
): Promise<unknown> {
  const payload = await apiRequest<unknown>(`/vm/${encodeURIComponent(code)}/eval`, {
    method: "POST",
    body: JSON.stringify({
      code: source,
      language: options.language,
      cellId: options.cellId,
      previousCellId: options.previousCellId,
    }),
  });
  return payload.result;
}

export async function evaluateRemoteCellOverStream(
  code: string,
  source: string,
  options: { language?: RemoteNotebookCellLanguage; cellId?: string; previousCellId?: string } = {},
): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    let settled = false;
    let executeSent = false;

    const stream = createRemoteNotebookExecutionStream({
      onClose: () => {
        if (settled) {
          return;
        }

        settled = true;
        reject(buildExecutionStreamTransportError("Notebook execution stream closed before a final result was received."));
      },
      onError: () => {
        if (settled) {
          return;
        }

        settled = true;
        stream.close();
        reject(buildExecutionStreamTransportError("Notebook execution stream failed to connect."));
      },
      onEvent: (event) => {
        if (settled) {
          return;
        }

        if (event.type === "ready") {
          if (!executeSent) {
            executeSent = true;
            stream.execute({
              code,
              source,
              language: options.language,
              cellId: options.cellId,
              previousCellId: options.previousCellId,
            });
          }
          return;
        }

        if (event.type === "result") {
          settled = true;
          stream.close();
          resolve(event.result);
          return;
        }

        if (event.type === "error") {
          settled = true;
          stream.close();
          reject(buildApiError(event.error));
          return;
        }

        if (event.type === "cancelled") {
          settled = true;
          stream.close();
          reject(buildApiError(event.reason));
        }
      },
    });
  });
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

export async function getRemoteNotebookTypeSource(
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const payload = await apiRequest<RemoteNotebookTypePayload>("/vm/types/notebook", {
    method: "GET",
    signal: options.signal,
  });

  if (typeof payload.result?.source !== "string") {
    throw buildApiError("Notebook type payload is incomplete.");
  }

  return payload.result.source;
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