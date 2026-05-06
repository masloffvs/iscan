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

export type VmPackageCreateRequestBody = {
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

export type VmPackagePrivilegeRequestBody = {
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
};

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

export type VmServerSocketData = VmBrowserStreamSocketData | VmPackageTerminalSocketData;

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
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

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
export const VM_BROWSER_STREAM_BINARY_KIND_AUDIO = 2;
