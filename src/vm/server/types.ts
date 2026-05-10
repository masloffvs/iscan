import type { BpkgPrivilegeLevel } from "../../kits/bpkg-kit";
import type { IsbNotebookDocument } from "../isb";
import type { RecoverableVm } from "../../modules";

export type VmCellLanguage = "javascript" | "sql";

export type VmInitRequestBody = {
  code?: string;
};

export type VmEvalRequestBody = {
  code: string;
  language: VmCellLanguage;
  cellId?: string;
  previousCellId?: string;
};

export type VmNotebookCellRuntimeResult = {
  cellId: string;
  language: VmCellLanguage;
  value: unknown;
  executedAt: number;
};

export type VmServerActiveEvaluation = {
  taskId: string | null;
  language: VmCellLanguage;
  cellId: string | null;
  previousCellId: string | null;
  startedAt: number;
  sourcePreview: string;
  sourceLineCount: number;
};

export type VmCompletionRequestBody = {
  fragment: string;
  language: VmCellLanguage;
};

export type VmFileRequestBody = {
  path: string;
};

export type VmMoveFileRequestBody = {
  path: string;
  targetPath: string;
};

export type VmSaveFileRequestBody = {
  notebook: IsbNotebookDocument;
};

export type VmBrowserActionRequestBody = {
  target: string;
  url?: string;
  x?: number;
  y?: number;
};

export type VmBrowserGestureRequestBody = {
  target: string;
  points: Array<{
    x: number;
    y: number;
  }>;
};

export type VmBrowserWheelRequestBody = {
  target: string;
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
};

export type VmBrowserKeyboardRequestBody = {
  target: string;
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

export type VmBrowserTabActivationRequestBody = {
  tabId: string;
};

export type VmBrowserTextRequestBody = {
  target: string;
  text: string;
};

export type VmBrowserProfileProxyMode = "none" | "saved" | "preserve";

export type VmBrowserProfileUpdateRequestBody = {
  headless: boolean;
  humanize: boolean;
  locale?: string;
  name: string;
  proxySelection: {
    mode: VmBrowserProfileProxyMode;
    proxyId?: string;
  };
  searchEngine?: string;
  timezone?: string;
  userAgent?: string;
  userDataDir?: string;
  viewportHeight?: number;
  viewportWidth?: number;
};

export type VmBrowserProfileSelectionMode = "empty" | "preset" | "custom-existing";

export type VmBrowserViewportSelection = {
  label: string | null;
  mode: VmBrowserProfileSelectionMode;
  presetId: string | null;
};

export type VmBrowserUserAgentSelection = {
  label: string | null;
  mode: VmBrowserProfileSelectionMode;
  userAgent: string | null;
};

export type VmBrowserProfileEditorData = {
  searchEnginePresets: readonly import("../../kits/cloak-profile-editor").CloakSearchEnginePreset[];
  userAgentOptions: readonly import("../../kits/cloak-profile-editor").CloakUserAgentOption[];
  userAgentSelection: VmBrowserUserAgentSelection;
  viewportPresets: readonly import("../../kits/cloak-profile-editor").CloakViewportPreset[];
  viewportSelection: VmBrowserViewportSelection;
};

type VmPackagePolicyBooleanFields = {
	allowHostPrivileged?: boolean;
	allowSandboxRw?: boolean;
	defaultSandboxRw?: boolean;
	hostDev?: boolean;
	hostProc?: boolean;
	hostSys?: boolean;
	shareNetwork?: boolean;
  unshareUser?: boolean;
  unshareIpc?: boolean;
  unsharePid?: boolean;
  unshareUts?: boolean;
  unshareCgroup?: boolean;
};

export type VmPackageCreateRequestBody = VmPackagePolicyBooleanFields & {
  allowedPrivilegeLevels?: BpkgPrivilegeLevel[];
  defaultPrivilegeLevel?: BpkgPrivilegeLevel;
  id: string;
  name?: string;
  description?: string;
  packages?: string[];
  privilegeLevel?: BpkgPrivilegeLevel;
  sandboxPolicyExtensions?: import("../../kits/bpkg-kit").BpkgSandboxPolicyExtensionsInput;
};

export type VmPackageActionRequestBody = {
  target: string;
};

export type VmPackageInstallRequestBody = {
  target?: string;
  packages: string[];
};

export type VmPackagePrivilegeRequestBody = VmPackagePolicyBooleanFields & {
  allowedPrivilegeLevels?: BpkgPrivilegeLevel[];
  defaultPrivilegeLevel?: BpkgPrivilegeLevel;
  sandboxPolicyExtensions?: import("../../kits/bpkg-kit").BpkgSandboxPolicyExtensionsInput;
  target?: string;
};

export type VmBrowserStreamSocketData = {
  kind: "browser-stream";
  target: string;
  quality?: number;
  everyNthFrame?: number;
  isClosed?: boolean;
  stopStream?: () => Promise<void>;
  requestTabsSnapshot?: () => Promise<void>;
  inputQueue?: Promise<void>;
  pendingPointerMove?: {
    x: number;
    y: number;
  };
};

export type VmBrowserAudioStreamSocketData = {
  kind: "browser-audio-stream";
  isClosed?: boolean;
};

export type VmBrowserStreamRefreshTabsClientMessage = {
  type: "refresh-tabs";
};

export type VmBrowserStreamPointerDownClientMessage = {
  type: "pointer-down";
  x: number;
  y: number;
};

export type VmBrowserStreamPointerMoveClientMessage = {
  type: "pointer-move";
  x: number;
  y: number;
};

export type VmBrowserStreamPointerUpClientMessage = {
  type: "pointer-up";
  x: number;
  y: number;
};

export type VmBrowserStreamClientMessage =
  | VmBrowserStreamRefreshTabsClientMessage
  | VmBrowserStreamPointerDownClientMessage
  | VmBrowserStreamPointerMoveClientMessage
  | VmBrowserStreamPointerUpClientMessage;

export type VmPackageTerminalSocketData = {
  kind: "package-terminal";
  target: string;
  cols?: number;
  privilegeLevel?: BpkgPrivilegeLevel;
  rows?: number;
  isClosed?: boolean;
  closeTerminal?: () => Promise<void>;
  writeTerminal?: (data: string) => Promise<void>;
};

export type VmExecutionStreamSocketData = {
  kind: "execution-stream";
  isClosed?: boolean;
  executionTaskId?: string;
  unsubscribeExecutionTask?: () => void;
};

export type VmInspectorStreamSocketData = {
  kind: "inspector-stream";
  code: string;
  isClosed?: boolean;
  stopStream?: () => void;
};

export type VmServerSocketData = VmBrowserStreamSocketData | VmBrowserAudioStreamSocketData | VmPackageTerminalSocketData | VmExecutionStreamSocketData | VmInspectorStreamSocketData;

export type VmFsWriteRequestBody = {
  path: string;
  content?: string;
  contentBase64?: string;
};

export type VmFsDeleteRequestBody = {
  path: string;
  recursive?: boolean;
};

export type VmServerSession = {
  code: string;
  relativePath?: string;
  notebook?: IsbNotebookDocument;
  vm: RecoverableVm;
  queue: Promise<void>;
  activeEvaluation: VmServerActiveEvaluation | null;
  notebookCellResults: Map<string, VmNotebookCellRuntimeResult>;
  lastNotebookCellId: string | null;
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type VmExecutionTaskLifecycleState = "queued" | "running" | "completed" | "failed" | "cancelled";

export type VmExecutionTaskSnapshot = {
  taskId: string;
  code: string;
  language: VmCellLanguage;
  cellId: string | null;
  previousCellId: string | null;
  status: VmExecutionTaskLifecycleState;
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

export type VmExecutionStreamReadyEvent = {
  type: "ready";
};

export type VmExecutionStreamQueuedEvent = {
  type: "queued";
  task: VmExecutionTaskSnapshot;
};

export type VmExecutionStreamQueueEvent = {
  type: "queue";
  task: VmExecutionTaskSnapshot;
};

export type VmExecutionStreamStartedEvent = {
  type: "started";
  task: VmExecutionTaskSnapshot;
};

export type VmExecutionStreamResultEvent = {
  type: "result";
  taskId: string;
  result: JsonValue;
};

export type VmExecutionStreamErrorEvent = {
  type: "error";
  taskId: string;
  error: string;
};

export type VmExecutionStreamCancelledEvent = {
  type: "cancelled";
  task: VmExecutionTaskSnapshot;
  reason: string;
};

export type VmExecutionStreamCompleteEvent = {
  type: "complete";
  task: VmExecutionTaskSnapshot;
};

export type VmExecutionStreamCancelAckEvent = {
  type: "cancel-ack";
  taskId: string;
  accepted: boolean;
  status: VmExecutionTaskLifecycleState | "unknown";
  message?: string;
};

export type VmExecutionStreamServerMessage =
  | VmExecutionStreamReadyEvent
  | VmExecutionStreamQueuedEvent
  | VmExecutionStreamQueueEvent
  | VmExecutionStreamStartedEvent
  | VmExecutionStreamResultEvent
  | VmExecutionStreamErrorEvent
  | VmExecutionStreamCancelledEvent
  | VmExecutionStreamCompleteEvent
  | VmExecutionStreamCancelAckEvent;

export type VmExecutionStreamExecuteClientMessage = {
  type: "execute";
  code: string;
  input: string;
  language?: VmCellLanguage;
  cellId?: string;
  previousCellId?: string;
};

export type VmExecutionStreamCancelClientMessage = {
  type: "cancel";
  taskId?: string;
};

export type VmExecutionStreamClientMessage =
  | VmExecutionStreamExecuteClientMessage
  | VmExecutionStreamCancelClientMessage;

export type VmInspectorStreamInspectNodeClientMessage = {
  type: "inspect-node";
  handle: string;
};

export type VmInspectorStreamCancelTaskClientMessage = {
  type: "cancel-task";
  taskId: string;
};

export type VmInspectorStreamClientMessage = VmInspectorStreamInspectNodeClientMessage | VmInspectorStreamCancelTaskClientMessage;

export type VmServerResponsePayload = {
  ok: boolean;
  code?: string;
  created?: boolean;
  relativePath?: string;
  snapshotPath?: string;
  result?: unknown;
  error?: string;
};

export type VmPackageTerminalClientMessage =
  | {
    type: "input";
    data: string;
  }
  | {
    type: "resize";
    cols?: number;
    rows?: number;
  };

export const VM_BROWSER_STREAM_BINARY_KIND_IMAGE = 1;
export const VM_EXECUTION_STREAM_BINARY_KIND_STDOUT = 3;
export const VM_EXECUTION_STREAM_BINARY_KIND_STDERR = 4;
