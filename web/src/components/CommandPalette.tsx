import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, memo } from "react";

import {
  runRemoteCommandPaletteCommand,
  searchRemoteExploitEntries,
  searchRemoteIsbEntries,
  type RemoteCommandPaletteCommand,
  type RemoteIsbSearchEntry,
  type RemoteCommandPaletteParam,
  type RemoteCommandPaletteRunResult,
  type RemoteExploitEntry,
} from "../api/client";
import {
  AI_AGENT_APPLICATION_ID,
  CLOAK_BROWSERS_APPLICATION_ID,
  CRAWL_AUDIT_APPLICATION_ID,
  EXPLOIT_VIEWER_APPLICATION_ID,
  INSPECTOR_VM_APPLICATION_ID,
  PORT_SCAN_APPLICATION_ID,
  POSTMAN_APPLICATION_ID,
  SETTINGS_APPLICATION_ID,
  ZOOMEYE_APPLICATION_ID,
  createCloakBrowsersInstanceTitle,
  createInspectorVmInstanceTitle,
  createExploitViewerInstanceTitle,
} from "../applications";
import { useInterfaceStore } from "../store/ui";

const MAX_VISIBLE_COMMANDS = 10;
const LOCAL_AI_AGENT_COMMAND_ID = "applications/ai-agent/open";
const LOCAL_CLOAK_BROWSERS_COMMAND_ID = "applications/cloak-browsers/open";
const LOCAL_CRAWL_AUDIT_COMMAND_ID = "applications/crawl-audit/open";
const LOCAL_INSPECTOR_VM_COMMAND_ID = "applications/inspector-vm/open";
const LOCAL_PORT_SCAN_COMMAND_ID = "applications/port-scan/open";
const LOCAL_POSTMAN_COMMAND_ID = "applications/postman/open";
const LOCAL_SETTINGS_COMMAND_ID = "applications/settings/open";
const LOCAL_ZOOMEYE_COMMAND_ID = "applications/zoomeye/open";
const SUBINPUT_EXPLOIT_SEARCH_COMMAND_ID = "kits/exploitdb/search";
const SUBINPUT_SEARCH_DEBOUNCE_MS = 180;

const LOCAL_AI_AGENT_COMMAND: RemoteCommandPaletteCommand = {
  id: LOCAL_AI_AGENT_COMMAND_ID,
  aliases: ["llm chat", "assistant", "ai chat"],
  category: "Pinned",
  title: "open ai agent",
  description: "Open the AI Agent mini-app with modal-based settings and per-instance chat history.",
  keywords: ["ai", "agent", "chat", "llm", "assistant"],
  defaultParameterName: null,
  consoleParams: [],
  hasRequiredParams: false,
  subInput: null,
};

const LOCAL_CLOAK_BROWSERS_COMMAND: RemoteCommandPaletteCommand = {
  id: LOCAL_CLOAK_BROWSERS_COMMAND_ID,
  aliases: ["cloak browser", "browser manager", "browser workspace"],
  category: "Pinned",
  title: "open cloak browsers",
  description: "Open the dedicated Cloak Browsers app with live profile controls, screenshots and profile settings.",
  keywords: ["cloak", "browser", "profiles", "fingerprint", "automation"],
  defaultParameterName: null,
  consoleParams: [],
  hasRequiredParams: false,
  subInput: null,
};

const LOCAL_INSPECTOR_VM_COMMAND: RemoteCommandPaletteCommand = {
  id: LOCAL_INSPECTOR_VM_COMMAND_ID,
  aliases: ["runtime inspector", "live inspector", "vm inspector", "notebook inspector"],
  category: "Pinned",
  title: "open inspector vm",
  description: "Open the Inspector VM mini-app for the currently selected notebook session.",
  keywords: ["inspector", "vm", "runtime", "bindings", "memory", "notebook"],
  defaultParameterName: null,
  consoleParams: [],
  hasRequiredParams: false,
  subInput: null,
};

const LOCAL_POSTMAN_COMMAND: RemoteCommandPaletteCommand = {
  id: LOCAL_POSTMAN_COMMAND_ID,
  aliases: ["http client", "api client"],
  category: "Pinned",
  title: "open postman",
  description: "Open the backend-proxied Postman mini-app with curl import and saved requests.",
  keywords: ["postman", "http", "curl", "request", "api"],
  defaultParameterName: null,
  consoleParams: [],
  hasRequiredParams: false,
  subInput: null,
};

const LOCAL_SETTINGS_COMMAND: RemoteCommandPaletteCommand = {
  id: LOCAL_SETTINGS_COMMAND_ID,
  aliases: ["preferences", "workspace settings", "config"],
  category: "Pinned",
  title: "open settings",
  description: "Open the workspace settings app backed by the dynamic registry and SQLite values.",
  keywords: ["settings", "preferences", "config", "workspace", "registry"],
  defaultParameterName: null,
  consoleParams: [],
  hasRequiredParams: false,
  subInput: null,
};

const LOCAL_PORT_SCAN_COMMAND: RemoteCommandPaletteCommand = {
  id: LOCAL_PORT_SCAN_COMMAND_ID,
  aliases: ["scan ports", "tcp scan", "open ports"],
  category: "Pinned",
  title: "open port scan",
  description: "Open the compact TCP port scan app with persisted history, policy badges and $.kits examples.",
  keywords: ["ports", "scan", "tcp", "network", "history"],
  defaultParameterName: null,
  consoleParams: [],
  hasRequiredParams: false,
  subInput: null,
};

const LOCAL_CRAWL_AUDIT_COMMAND: RemoteCommandPaletteCommand = {
  id: LOCAL_CRAWL_AUDIT_COMMAND_ID,
  aliases: ["resource graph", "chunk graph", "crawl auditor", "runtime map"],
  category: "Pinned",
  title: "open crawl auditor",
  description: "Open the crawl auditor mini-app to map runtime resources, chunks, source maps and leakage findings.",
  keywords: ["crawl", "audit", "graph", "chunks", "sourcemap", "resources"],
  defaultParameterName: null,
  consoleParams: [],
  hasRequiredParams: false,
  subInput: null,
};

const LOCAL_ZOOMEYE_COMMAND: RemoteCommandPaletteCommand = {
  id: LOCAL_ZOOMEYE_COMMAND_ID,
  aliases: ["zoomeye live", "zoomeye search"],
  category: "Pinned",
  title: "open zoomeye",
  description: "Open the live ZoomEye search mini-app with CloakBrowser profile selection and persisted table results.",
  keywords: ["zoomeye", "search", "hosts", "realtime", "discovery"],
  defaultParameterName: null,
  consoleParams: [],
  hasRequiredParams: false,
  subInput: null,
};

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (
      target.isContentEditable
      || target.tagName === "INPUT"
      || target.tagName === "TEXTAREA"
      || target.tagName === "SELECT"
    );
}

function formatCommandSearchText(command: RemoteCommandPaletteCommand): string {
  return [
    command.title,
    command.id,
    command.category,
    command.description,
    ...command.aliases,
    ...command.keywords,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" \n ")
    .toLowerCase();
}

function getCommandSearchScore(
  command: RemoteCommandPaletteCommand,
  query: string,
  recentIndexById: Map<string, number>,
): number {
  const recentBonus = recentIndexById.has(command.id)
    ? Math.max(18 - (recentIndexById.get(command.id) ?? 0), 1)
    : 0;

  if (query.length === 0) {
    return recentBonus;
  }

  const normalizedTitle = command.title.toLowerCase();
  const normalizedId = command.id.toLowerCase();
  const normalizedDescription = command.description?.toLowerCase() ?? "";
  const normalizedAliases = command.aliases.map((alias) => alias.toLowerCase());
  const normalizedKeywords = command.keywords.map((keyword) => keyword.toLowerCase());
  const haystack = formatCommandSearchText(command);

  let score = recentBonus;
  if (normalizedTitle === query || normalizedId === query) {
    score += 200;
  }
  if (normalizedTitle.startsWith(query)) {
    score += 120;
  }
  if (normalizedId.startsWith(query)) {
    score += 100;
  }
  if (normalizedAliases.some((alias) => alias.startsWith(query))) {
    score += 84;
  }
  if (normalizedKeywords.some((keyword) => keyword.startsWith(query))) {
    score += 72;
  }
  if (normalizedTitle.includes(query)) {
    score += 60;
  }
  if (normalizedId.includes(query)) {
    score += 44;
  }
  if (normalizedDescription.includes(query)) {
    score += 24;
  }
  if (haystack.includes(query)) {
    score += 12;
  }

  return score;
}

function formatCommandMeta(command: RemoteCommandPaletteCommand): string {
  const parts = [command.category];
  if (command.defaultParameterName) {
    parts.push(`default: ${command.defaultParameterName}`);
  }
  if (command.consoleParams.length > 0) {
    parts.push(`${command.consoleParams.length} param${command.consoleParams.length === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

function formatCommandListSummary(command: RemoteCommandPaletteCommand): string {
  const description = command.description?.trim();
  if (description) {
    return `${command.category} · ${description}`;
  }

  if (command.consoleParams.length > 0 || command.defaultParameterName) {
    return formatCommandMeta(command);
  }

  if (command.aliases[0]) {
    return `${command.category} · ${command.aliases[0]}`;
  }

  return `${command.category} · ${command.id}`;
}

function formatResultPreview(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    const preview = JSON.stringify(value, null, 2);
    if (preview.length <= 1600) {
      return preview;
    }

    return `${preview.slice(0, 1597)}...`;
  } catch {
    return String(value);
  }
}

function formatExploitResultMeta(entry: RemoteExploitEntry): string {
  const parts = [
    entry.typeDisplay,
    entry.platformDisplay,
    entry.authorName,
    entry.datePublished,
    entry.verified ? "verified" : null,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return parts.join(" · ");
}

function parseBooleanValue(rawValue: string, fieldName: string): boolean | undefined {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${fieldName} must be true or false.`);
}

function parseCommandParamValue(param: RemoteCommandPaletteParam, rawValue: string): unknown {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  switch (param.valueType) {
    case "number": {
      const parsedValue = Number(trimmed);
      if (!Number.isFinite(parsedValue)) {
        throw new Error(`${param.name} must be a number.`);
      }

      return parsedValue;
    }
    case "boolean":
      return parseBooleanValue(trimmed, param.name);
    case "json": {
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        throw new Error(`${param.name} must be valid JSON.`);
      }
    }
    case "string[]":
      return trimmed
        .split(/[,\n]/u)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    default:
      return trimmed;
  }
}

function createInitialParamDrafts(command: RemoteCommandPaletteCommand): Record<string, string> {
  return Object.fromEntries(command.consoleParams.map((param) => [param.name, ""])) as Record<string, string>;
}

function commandNeedsForm(command: RemoteCommandPaletteCommand): boolean {
  return Boolean(command.defaultParameterName) || command.consoleParams.length > 0;
}

function buildCommandParams(
  command: RemoteCommandPaletteCommand,
  defaultParamValue: string,
  paramDrafts: Record<string, string>,
): unknown {
  if (command.consoleParams.length === 0) {
    const trimmedDefaultValue = defaultParamValue.trim();
    if (command.defaultParameterName && trimmedDefaultValue.length === 0) {
      throw new Error(`${command.defaultParameterName} is required.`);
    }

    return trimmedDefaultValue;
  }

  const params: Record<string, unknown> = {};
  for (const param of command.consoleParams) {
    const parsedValue = parseCommandParamValue(param, paramDrafts[param.name] ?? "");
    if (parsedValue === undefined) {
      if (param.required) {
        throw new Error(`${param.name} is required.`);
      }
      continue;
    }

    params[param.name] = parsedValue;
  }

  return params;
}

function focusTextInput(node: HTMLInputElement | null, selectIfEmpty = false): number | null {
  if (!node) {
    return null;
  }

  return window.requestAnimationFrame(() => {
    if (!node.isConnected) {
      return;
    }

    node.focus();

    if (selectIfEmpty && node.value.length === 0) {
      node.select();
      return;
    }

    const end = node.value.length;
    try {
      node.setSelectionRange(end, end);
    } catch {
      // Ignore inputs that don't support text selection APIs.
    }
  });
}

type PaletteHomeCategory = {
  id: string;
  label: string;
  commandCount: number;
};

type CommandSubInputSpec = {
  mode: "default" | "param";
  fieldName: string;
  label: string;
  placeholder: string | null;
  submitLabel: string;
};

type PaletteCommandItem = {
  kind: "command";
  id: string;
  category: string;
  title: string;
  summary: string;
  searchText: string;
  command: RemoteCommandPaletteCommand;
};

type PaletteNotebookItem = {
  kind: "notebook";
  id: string;
  category: string;
  title: string;
  summary: string;
  searchText: string;
  relativePath: string;
  matchScore?: number;
};

type PaletteNotebookCellItem = {
  kind: "notebook-cell";
  id: string;
  category: string;
  title: string;
  summary: string;
  searchText: string;
  notebookId: string;
  cellId: string;
  matchScore?: number;
};

type PaletteVmFileItem = {
  kind: "vm-file";
  id: string;
  category: string;
  title: string;
  summary: string;
  searchText: string;
  path: string;
  matchScore?: number;
};

type PaletteApplicationInstanceItem = {
  kind: "application-instance";
  id: string;
  category: string;
  title: string;
  summary: string;
  searchText: string;
  instanceId: string;
  matchScore?: number;
};

type PaletteItem =
  | PaletteCommandItem
  | PaletteNotebookItem
  | PaletteNotebookCellItem
  | PaletteVmFileItem
  | PaletteApplicationInstanceItem;

const NOTEBOOK_ITEM_ID_PREFIX = "notebooks/open/";
const NOTEBOOK_CELL_ITEM_ID_PREFIX = "notebooks/search/";
const VM_FILE_ITEM_ID_PREFIX = "vm-files/open/";
const APPLICATION_INSTANCE_ITEM_ID_PREFIX = "applications/select/";

function createSearchText(...values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" \n ")
    .toLowerCase();
}

function squashText(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function basename(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts.at(-1) ?? value;
}

function createCommandPaletteItem(command: RemoteCommandPaletteCommand): PaletteCommandItem {
  return {
    kind: "command",
    id: command.id,
    category: command.category,
    title: command.title,
    summary: formatCommandListSummary(command),
    searchText: formatCommandSearchText(command),
    command,
  };
}

function getGenericPaletteItemScore(
  item: Exclude<PaletteItem, PaletteCommandItem>,
  query: string,
  recentIndexById: Map<string, number>,
): number {
  const recentBonus = recentIndexById.has(item.id)
    ? Math.max(18 - (recentIndexById.get(item.id) ?? 0), 1)
    : 0;

  if (query.length === 0) {
    return recentBonus;
  }

  if (typeof item.matchScore === "number" && item.matchScore > 0) {
    return recentBonus + item.matchScore;
  }

  const normalizedTitle = item.title.toLowerCase();
  const normalizedSummary = item.summary.toLowerCase();
  const normalizedCategory = item.category.toLowerCase();

  let score = recentBonus;
  if (normalizedTitle === query) {
    score += 180;
  }
  if (normalizedTitle.startsWith(query)) {
    score += 110;
  }
  if (normalizedSummary.startsWith(query)) {
    score += 76;
  }
  if (normalizedTitle.includes(query)) {
    score += 58;
  }
  if (normalizedSummary.includes(query)) {
    score += 30;
  }
  if (normalizedCategory.includes(query)) {
    score += 24;
  }
  if (item.searchText.includes(query)) {
    score += item.kind === "notebook-cell" ? 34 : 14;
  }

  return score;
}

function getPaletteItemSearchScore(
  item: PaletteItem,
  query: string,
  recentIndexById: Map<string, number>,
): number {
  if (item.kind === "command") {
    return getCommandSearchScore(item.command, query, recentIndexById);
  }

  return getGenericPaletteItemScore(item, query, recentIndexById);
}

function formatPaletteItemListSummary(item: PaletteItem): string {
  return item.summary;
}

function buildHomeCategories(commands: readonly RemoteCommandPaletteCommand[]): PaletteHomeCategory[] {
  const groupedCategories = new Map<string, PaletteHomeCategory>();

  for (const command of commands) {
    const categoryId = command.category.trim() || "misc";
    const currentValue = groupedCategories.get(categoryId);
    if (currentValue) {
      currentValue.commandCount += 1;
      continue;
    }

    groupedCategories.set(categoryId, {
      id: categoryId,
      label: categoryId,
      commandCount: 1,
    });
  }

  return [...groupedCategories.values()].sort((left, right) => {
    if (right.commandCount !== left.commandCount) {
      return right.commandCount - left.commandCount;
    }

    return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
  });
}

function getCommandSubInputSpec(command: RemoteCommandPaletteCommand | null): CommandSubInputSpec | null {
  if (!command?.subInput) {
    return null;
  }

  if (command.defaultParameterName) {
    return {
      mode: "default",
      fieldName: command.defaultParameterName,
      label: command.subInput.label ?? command.defaultParameterName,
      placeholder: command.subInput.placeholder ?? null,
      submitLabel: command.subInput.submitLabel ?? `Run ${command.title}`,
    };
  }

  if (command.consoleParams.length !== 1) {
    return null;
  }

  const [param] = command.consoleParams;
  if (!param || (param.values && param.values.length > 0) || param.valueType === "boolean" || param.valueType === "json") {
    return null;
  }

  return {
    mode: "param",
    fieldName: param.name,
    label: command.subInput.label ?? param.name,
    placeholder: command.subInput.placeholder ?? param.example ?? null,
    submitLabel: command.subInput.submitLabel ?? `Run ${command.title}`,
  };
}

export default memo(function CommandPalette() {
  const commandFormId = "command-palette-detail-form";
  const commandPaletteOpen = useInterfaceStore((state) => state.commandPaletteOpen);
  const commandPaletteCommands = useInterfaceStore((state) => state.commandPaletteCommands);
  const commandPaletteError = useInterfaceStore((state) => state.commandPaletteError);
  const commandPaletteQuery = useInterfaceStore((state) => state.commandPaletteQuery);
  const commandPaletteSelectedCommandId = useInterfaceStore((state) => state.commandPaletteSelectedCommandId);
  const isCommandPaletteLoading = useInterfaceStore((state) => state.isCommandPaletteLoading);
  const recentCommandPaletteCommandIds = useInterfaceStore((state) => state.recentCommandPaletteCommandIds);
  const isbFiles = useInterfaceStore((state) => state.isbFiles);
  const notebookDirtyByFile = useInterfaceStore((state) => state.notebookDirtyByFile);
  const fsEntries = useInterfaceStore((state) => state.fsEntries);
  const applicationInstances = useInterfaceStore((state) => state.applicationInstances);
  const selectedApplicationInstanceId = useInterfaceStore((state) => state.selectedApplicationInstanceId);
  const closeCommandPalette = useInterfaceStore((state) => state.closeCommandPalette);
  const loadCommandPaletteCommands = useInterfaceStore((state) => state.loadCommandPaletteCommands);
  const openApplicationInstance = useInterfaceStore((state) => state.openApplicationInstance);
  const rememberCommandPaletteCommand = useInterfaceStore((state) => state.rememberCommandPaletteCommand);
  const setCommandPaletteQuery = useInterfaceStore((state) => state.setCommandPaletteQuery);
  const setCommandPaletteSelectedCommandId = useInterfaceStore((state) => state.setCommandPaletteSelectedCommandId);
  const selectedFileId = useInterfaceStore((state) => state.selectedFileId);
  const selectedInspectorSessionCode = useInterfaceStore((state) => {
    const currentSelectedFileId = state.selectedFileId;
    return currentSelectedFileId ? (state.sessionCodeByFile[currentSelectedFileId] ?? "") : "";
  });
  const switchRemoteFile = useInterfaceStore((state) => state.switchRemoteFile);
  const selectApplicationInstance = useInterfaceStore((state) => state.selectApplicationInstance);
  const focusCell = useInterfaceStore((state) => state.focusCell);
  const openFsFile = useInterfaceStore((state) => state.openFsFile);
  const setModal = useInterfaceStore((state) => state.setModal);
  const selectRightPanelTab = useInterfaceStore((state) => state.selectRightPanelTab);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedHomeCategory, setSelectedHomeCategory] = useState<string | null>(null);
  const [subInputCommandId, setSubInputCommandId] = useState<string | null>(null);
  const [screenCommandId, setScreenCommandId] = useState<string | null>(null);
  const [defaultParamValue, setDefaultParamValue] = useState("");
  const [paramDrafts, setParamDrafts] = useState<Record<string, string>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RemoteCommandPaletteRunResult | null>(null);
  const [subInputSearchEntries, setSubInputSearchEntries] = useState<RemoteExploitEntry[]>([]);
  const [selectedSubInputSearchEntryId, setSelectedSubInputSearchEntryId] = useState<string | null>(null);
  const [subInputSearchError, setSubInputSearchError] = useState<string | null>(null);
  const [isSubInputSearching, setIsSubInputSearching] = useState(false);
  const [isbSearchEntries, setIsbSearchEntries] = useState<RemoteIsbSearchEntry[]>([]);
  const [isbSearchError, setIsbSearchError] = useState<string | null>(null);
  const [isIsbSearching, setIsIsbSearching] = useState(false);
  const normalizedQuery = commandPaletteQuery.trim().toLowerCase();
  const subInputSearchRequestIdRef = useRef(0);
  const isbSearchRequestIdRef = useRef(0);
  const availableCommands = useMemo(
    () => [LOCAL_INSPECTOR_VM_COMMAND, LOCAL_CLOAK_BROWSERS_COMMAND, LOCAL_SETTINGS_COMMAND, LOCAL_AI_AGENT_COMMAND, LOCAL_CRAWL_AUDIT_COMMAND, LOCAL_PORT_SCAN_COMMAND, LOCAL_ZOOMEYE_COMMAND, LOCAL_POSTMAN_COMMAND, ...commandPaletteCommands],
    [commandPaletteCommands],
  );
  const commandItems = useMemo(
    () => availableCommands.map(createCommandPaletteItem),
    [availableCommands],
  );

  useEffect(() => {
    if (!commandPaletteOpen) {
      setActiveCategory(null);
      setSelectedHomeCategory(null);
      setSubInputCommandId(null);
      setScreenCommandId(null);
      setDefaultParamValue("");
      setParamDrafts({});
      setIsRunning(false);
      setRunError(null);
      setRunResult(null);
      setSubInputSearchEntries([]);
      setSelectedSubInputSearchEntryId(null);
      setSubInputSearchError(null);
      setIsSubInputSearching(false);
      setIsbSearchEntries([]);
      setIsbSearchError(null);
      setIsIsbSearching(false);
      return;
    }

    if (commandPaletteCommands.length === 0 && !isCommandPaletteLoading) {
      void loadCommandPaletteCommands().catch(() => {});
    }

  }, [commandPaletteCommands.length, commandPaletteOpen, isCommandPaletteLoading, loadCommandPaletteCommands]);

  const homeCategories = useMemo(
    () => buildHomeCategories(availableCommands),
    [availableCommands],
  );

  const notebookItems = useMemo<PaletteNotebookItem[]>(() => {
    return isbFiles.map((entry) => {
      const label = basename(entry.relativePath);
      const dirty = Boolean(notebookDirtyByFile[entry.relativePath]);
      return {
        kind: "notebook",
        id: `${NOTEBOOK_ITEM_ID_PREFIX}${entry.relativePath}`,
        category: "sketchbooks",
        title: label,
        summary: `${entry.relativePath} · ${entry.cellCount} cell${entry.cellCount === 1 ? "" : "s"}${dirty ? " · unsaved" : ""}`,
        searchText: createSearchText(entry.relativePath, entry.title, label, dirty ? "unsaved dirty" : null),
        relativePath: entry.relativePath,
      };
    });
  }, [isbFiles, notebookDirtyByFile]);

  const notebookCellItems = useMemo<PaletteNotebookCellItem[]>(() => {
    return isbSearchEntries.map((entry) => {
      const preview = squashText(entry.preview || entry.cellTitle || entry.cellId, 88);
      const cellLabel = entry.cellLanguage ? `${entry.cellKind} · ${entry.cellLanguage}` : entry.cellKind;
      return {
        kind: "notebook-cell",
        id: `${NOTEBOOK_CELL_ITEM_ID_PREFIX}${entry.relativePath}:${entry.cellId}`,
        category: "notebook search",
        title: preview.length > 0 ? preview : entry.cellTitle,
        summary: `${entry.relativePath} · ${cellLabel}`,
        searchText: createSearchText(entry.notebookTitle, entry.relativePath, entry.cellTitle, entry.preview, entry.cellKind, entry.cellLanguage),
        notebookId: entry.relativePath,
        cellId: entry.cellId,
        matchScore: entry.score + 40,
      };
    });
  }, [isbSearchEntries]);

  const applicationInstanceItems = useMemo<PaletteApplicationInstanceItem[]>(() => {
    return applicationInstances.map((instance) => ({
      kind: "application-instance",
      id: `${APPLICATION_INSTANCE_ITEM_ID_PREFIX}${instance.instanceId}`,
      category: "applications",
      title: instance.title,
      summary: `open app · ${instance.applicationId}${selectedApplicationInstanceId === instance.instanceId ? " · active" : ""}`,
      searchText: createSearchText(instance.title, instance.applicationId, selectedApplicationInstanceId === instance.instanceId ? "active" : null),
      instanceId: instance.instanceId,
    }));
  }, [applicationInstances, selectedApplicationInstanceId]);

  const vmFileItems = useMemo<PaletteVmFileItem[]>(() => {
    if (normalizedQuery.length === 0) {
      return [];
    }

    return fsEntries
      .filter((entry) => entry.kind === "file")
      .map((entry) => ({
        kind: "vm-file",
        id: `${VM_FILE_ITEM_ID_PREFIX}${entry.path}`,
        category: "files",
        title: entry.name,
        summary: `vm file · ${entry.path}`,
        searchText: createSearchText(entry.name, entry.path),
        path: entry.path,
      }));
  }, [fsEntries, normalizedQuery.length]);

  const categoryScopedItems = useMemo(() => {
    if (activeCategory) {
      return commandItems.filter((item) => item.category === activeCategory);
    }

    if (normalizedQuery.length === 0) {
      return commandItems;
    }

    return [
      ...commandItems,
      ...applicationInstanceItems,
      ...notebookItems,
      ...vmFileItems,
      ...notebookCellItems,
    ];
  }, [activeCategory, applicationInstanceItems, commandItems, normalizedQuery.length, notebookCellItems, notebookItems, vmFileItems]);

  const filteredItems = useMemo(() => {
    if (activeCategory === null && normalizedQuery.length === 0) {
      return [];
    }

    const recentIndexById = new Map(
      recentCommandPaletteCommandIds.map((id, index) => [id, index]),
    );

    return categoryScopedItems
      .map((item) => ({
        item,
        score: getPaletteItemSearchScore(item, normalizedQuery, recentIndexById),
      }))
      .filter(({ score }) => normalizedQuery.length === 0 || score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return left.item.title.localeCompare(right.item.title, undefined, { sensitivity: "base" });
      })
      .slice(0, MAX_VISIBLE_COMMANDS)
      .map(({ item }) => item);
  }, [activeCategory, categoryScopedItems, normalizedQuery, recentCommandPaletteCommandIds]);

  const screenCommand = useMemo(() => {
    return availableCommands.find((command) => command.id === screenCommandId) ?? null;
  }, [availableCommands, screenCommandId]);

  const subInputCommand = useMemo(() => {
    return availableCommands.find((command) => command.id === subInputCommandId) ?? null;
  }, [availableCommands, subInputCommandId]);

  const subInputSpec = useMemo(
    () => getCommandSubInputSpec(subInputCommand),
    [subInputCommand],
  );

  const subInputValue = subInputSpec
    ? (subInputSpec.mode === "default" ? defaultParamValue : (paramDrafts[subInputSpec.fieldName] ?? ""))
    : "";
  const isExploitSearchSubInput = subInputCommand?.id === SUBINPUT_EXPLOIT_SEARCH_COMMAND_ID && Boolean(subInputSpec);
  const selectedSubInputSearchEntry = useMemo(() => {
    return subInputSearchEntries.find((entry) => entry.exploitId === selectedSubInputSearchEntryId)
      ?? subInputSearchEntries[0]
      ?? null;
  }, [selectedSubInputSearchEntryId, subInputSearchEntries]);

  const isHomeMode = screenCommand === null && activeCategory === null && normalizedQuery.length === 0;

  useEffect(() => {
    if (!commandPaletteOpen || !isHomeMode) {
      return;
    }

    if (homeCategories.length === 0) {
      if (selectedHomeCategory !== null) {
        setSelectedHomeCategory(null);
      }
      return;
    }

    const selectedStillVisible = homeCategories.some((category) => category.id === selectedHomeCategory);
    if (!selectedStillVisible) {
      setSelectedHomeCategory(homeCategories[0]?.id ?? null);
    }
  }, [commandPaletteOpen, homeCategories, isHomeMode, selectedHomeCategory]);

  useEffect(() => {
    if (!commandPaletteOpen || isHomeMode || screenCommand) {
      return;
    }

    if (filteredItems.length === 0) {
      if (commandPaletteSelectedCommandId !== null) {
        setCommandPaletteSelectedCommandId(null);
      }
      return;
    }

    const selectedStillVisible = filteredItems.some((item) => item.id === commandPaletteSelectedCommandId);
    if (!selectedStillVisible) {
      setCommandPaletteSelectedCommandId(filteredItems[0]?.id ?? null);
    }
  }, [commandPaletteOpen, commandPaletteSelectedCommandId, filteredItems, isHomeMode, screenCommand, setCommandPaletteSelectedCommandId]);

  useEffect(() => {
    if (!commandPaletteOpen) {
      return;
    }

    const frameId = !screenCommand
      ? focusTextInput(inputRef.current, true)
      : null;

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [commandPaletteOpen, screenCommand, subInputCommandId]);

  const selectedHomeCategoryItem = useMemo(() => {
    return homeCategories.find((category) => category.id === selectedHomeCategory)
      ?? homeCategories[0]
      ?? null;
  }, [homeCategories, selectedHomeCategory]);

  const selectedItem = useMemo(() => {
    return filteredItems.find((item) => item.id === commandPaletteSelectedCommandId)
      ?? filteredItems[0]
      ?? null;
  }, [commandPaletteSelectedCommandId, filteredItems]);

  function openCommandScreen(command: RemoteCommandPaletteCommand): void {
    setScreenCommandId(command.id);
    setSubInputCommandId(null);
    setDefaultParamValue("");
    setParamDrafts(createInitialParamDrafts(command));
    setRunError(null);
    setRunResult(null);
  }

  function enterSubInput(command: RemoteCommandPaletteCommand): void {
    setSubInputCommandId(command.id);
    setScreenCommandId(null);
    setDefaultParamValue("");
    setParamDrafts(createInitialParamDrafts(command));
    setSubInputSearchEntries([]);
    setSelectedSubInputSearchEntryId(null);
    setSubInputSearchError(null);
    setIsSubInputSearching(false);
    setRunError(null);
    setRunResult(null);
  }

  function exitSubInput(): void {
    setSubInputCommandId(null);
    setDefaultParamValue("");
    setParamDrafts({});
    setSubInputSearchEntries([]);
    setSelectedSubInputSearchEntryId(null);
    setSubInputSearchError(null);
    setIsSubInputSearching(false);
    setRunError(null);
  }

  function openExploitViewer(entry: RemoteExploitEntry): void {
    const initialTitle = `${entry.exploitId} · ${entry.title}`;
    openApplicationInstance({
      applicationId: EXPLOIT_VIEWER_APPLICATION_ID,
      title: createExploitViewerInstanceTitle({
        exploitId: entry.exploitId,
        initialTitle,
      }),
      input: {
        exploitId: entry.exploitId,
        initialTitle,
      },
    });
    rememberCommandPaletteCommand(SUBINPUT_EXPLOIT_SEARCH_COMMAND_ID);
    closeCommandPalette();
  }

  function openPostmanApplication(): void {
    openApplicationInstance({
      applicationId: POSTMAN_APPLICATION_ID,
      title: "Postman · new request",
      input: {},
    });
    rememberCommandPaletteCommand(LOCAL_POSTMAN_COMMAND_ID);
    closeCommandPalette();
  }

  function openCloakBrowsersApplication(): void {
    openApplicationInstance({
      applicationId: CLOAK_BROWSERS_APPLICATION_ID,
      title: createCloakBrowsersInstanceTitle(),
      input: {},
    });
    rememberCommandPaletteCommand(LOCAL_CLOAK_BROWSERS_COMMAND_ID);
    closeCommandPalette();
  }

  function openSettingsApplication(): void {
    openApplicationInstance({
      applicationId: SETTINGS_APPLICATION_ID,
      title: "Settings · workspace",
      input: {},
    });
    rememberCommandPaletteCommand(LOCAL_SETTINGS_COMMAND_ID);
    closeCommandPalette();
  }

  function openPortScanApplication(): void {
    openApplicationInstance({
      applicationId: PORT_SCAN_APPLICATION_ID,
      title: "Port Scan · compact console",
      input: {},
    });
    rememberCommandPaletteCommand(LOCAL_PORT_SCAN_COMMAND_ID);
    closeCommandPalette();
  }

  function openCrawlAuditApplication(): void {
    openApplicationInstance({
      applicationId: CRAWL_AUDIT_APPLICATION_ID,
      title: "Crawl Auditor · resource map",
      input: {},
    });
    rememberCommandPaletteCommand(LOCAL_CRAWL_AUDIT_COMMAND_ID);
    closeCommandPalette();
  }

  function openAiAgentApplication(): void {
    openApplicationInstance({
      applicationId: AI_AGENT_APPLICATION_ID,
      title: "AI Agent · new chat",
      input: {},
    });
    rememberCommandPaletteCommand(LOCAL_AI_AGENT_COMMAND_ID);
    closeCommandPalette();
  }

  function openInspectorVmApplication(): void {
    openApplicationInstance({
      applicationId: INSPECTOR_VM_APPLICATION_ID,
      title: createInspectorVmInstanceTitle(selectedFileId),
      input: {
        sessionCode: selectedInspectorSessionCode || null,
        relativePath: selectedFileId || null,
      },
    });
    rememberCommandPaletteCommand(LOCAL_INSPECTOR_VM_COMMAND_ID);
    closeCommandPalette();
  }

  function openZoomEyeApplication(): void {
    openApplicationInstance({
      applicationId: ZOOMEYE_APPLICATION_ID,
      title: "ZoomEye · live search",
      input: {},
    });
    rememberCommandPaletteCommand(LOCAL_ZOOMEYE_COMMAND_ID);
    closeCommandPalette();
  }

  function closeCommandScreen(): void {
    setScreenCommandId(null);
    setDefaultParamValue("");
    setParamDrafts({});
    setRunError(null);
    setRunResult(null);
  }

  function openCategory(categoryId: string): void {
    setActiveCategory(categoryId);
    setSelectedHomeCategory(categoryId);
    setRunError(null);
    setRunResult(null);
  }

  async function executeCommand(command: RemoteCommandPaletteCommand, params?: unknown): Promise<void> {
    setIsRunning(true);
    setRunError(null);
    try {
      const result = await runRemoteCommandPaletteCommand(command.id, params);
      rememberCommandPaletteCommand(command.id);
      setRunResult(result);
      setCommandPaletteSelectedCommandId(command.id);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRunning(false);
    }
  }

  async function handlePrimaryAction(item: PaletteItem | null): Promise<void> {
    if (!item) {
      return;
    }

    if (item.kind === "application-instance") {
      selectApplicationInstance(item.instanceId);
      rememberCommandPaletteCommand(item.id);
      closeCommandPalette();
      return;
    }

    if (item.kind === "notebook") {
      await switchRemoteFile(item.relativePath);
      rememberCommandPaletteCommand(item.id);
      closeCommandPalette();
      return;
    }

    if (item.kind === "notebook-cell") {
      await switchRemoteFile(item.notebookId);
      focusCell(item.cellId);
      rememberCommandPaletteCommand(item.id);
      closeCommandPalette();
      return;
    }

    if (item.kind === "vm-file") {
      await selectRightPanelTab("files");
      await openFsFile(item.path);
      setModal("file-editor");
      rememberCommandPaletteCommand(item.id);
      closeCommandPalette();
      return;
    }

    const command = item.command;

    if (command.id === LOCAL_INSPECTOR_VM_COMMAND_ID) {
      openInspectorVmApplication();
      return;
    }

    if (command.id === LOCAL_AI_AGENT_COMMAND_ID) {
      openAiAgentApplication();
      return;
    }

    if (command.id === LOCAL_CLOAK_BROWSERS_COMMAND_ID) {
      openCloakBrowsersApplication();
      return;
    }

    if (command.id === LOCAL_POSTMAN_COMMAND_ID) {
      openPostmanApplication();
      return;
    }

    if (command.id === LOCAL_SETTINGS_COMMAND_ID) {
      openSettingsApplication();
      return;
    }

		if (command.id === LOCAL_PORT_SCAN_COMMAND_ID) {
			openPortScanApplication();
			return;
		}

    if (command.id === LOCAL_CRAWL_AUDIT_COMMAND_ID) {
      openCrawlAuditApplication();
      return;
    }

    if (command.id === LOCAL_ZOOMEYE_COMMAND_ID) {
      openZoomEyeApplication();
      return;
    }

    if (getCommandSubInputSpec(command)) {
      enterSubInput(command);
      return;
    }

    openCommandScreen(command);
  }

  async function handleSubmitCommandForm(): Promise<void> {
    const activeCommand = screenCommand ?? subInputCommand;
    if (!activeCommand) {
      return;
    }

    if (isExploitSearchSubInput && selectedSubInputSearchEntry) {
      openExploitViewer(selectedSubInputSearchEntry);
      return;
    }

    try {
      const params = buildCommandParams(activeCommand, defaultParamValue, paramDrafts);
      await executeCommand(activeCommand, params);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    if (!commandPaletteOpen || !isExploitSearchSubInput || !subInputSpec) {
      setSubInputSearchEntries([]);
      setSubInputSearchError(null);
      setIsSubInputSearching(false);
      return;
    }

    const query = subInputValue.trim();
    if (query.length === 0) {
      setSubInputSearchEntries([]);
      setSelectedSubInputSearchEntryId(null);
      setSubInputSearchError(null);
      setIsSubInputSearching(false);
      return;
    }

    const controller = new AbortController();
    const requestId = subInputSearchRequestIdRef.current + 1;
    subInputSearchRequestIdRef.current = requestId;
    setIsSubInputSearching(true);
    setSubInputSearchError(null);

    const timeoutId = window.setTimeout(() => {
      void searchRemoteExploitEntries(
        query,
        MAX_VISIBLE_COMMANDS,
        { signal: controller.signal },
      )
        .then((entries) => {
          if (subInputSearchRequestIdRef.current !== requestId) {
            return;
          }

          setSubInputSearchEntries(entries);
          setSelectedSubInputSearchEntryId((currentId) => entries.some((entry) => entry.exploitId === currentId)
            ? currentId
            : (entries[0]?.exploitId ?? null));
          setSubInputSearchError(null);
        })
        .catch((error) => {
          if (controller.signal.aborted || subInputSearchRequestIdRef.current !== requestId) {
            return;
          }

          setSubInputSearchEntries([]);
          setSelectedSubInputSearchEntryId(null);
          setSubInputSearchError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (subInputSearchRequestIdRef.current === requestId) {
            setIsSubInputSearching(false);
          }
        });
    }, SUBINPUT_SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [commandPaletteOpen, isExploitSearchSubInput, subInputSpec, subInputValue]);

  useEffect(() => {
    if (!commandPaletteOpen || activeCategory !== null || normalizedQuery.length === 0 || screenCommand || subInputCommand) {
      setIsbSearchEntries([]);
      setIsbSearchError(null);
      setIsIsbSearching(false);
      return;
    }

    const controller = new AbortController();
    const requestId = isbSearchRequestIdRef.current + 1;
    isbSearchRequestIdRef.current = requestId;
    setIsIsbSearching(true);
    setIsbSearchError(null);

    const timeoutId = window.setTimeout(() => {
      void searchRemoteIsbEntries(
        normalizedQuery,
        MAX_VISIBLE_COMMANDS,
        { signal: controller.signal },
      )
        .then((entries) => {
          if (isbSearchRequestIdRef.current !== requestId) {
            return;
          }

          setIsbSearchEntries(entries);
          setIsbSearchError(null);
        })
        .catch((error) => {
          if (controller.signal.aborted || isbSearchRequestIdRef.current !== requestId) {
            return;
          }

          setIsbSearchEntries([]);
          setIsbSearchError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (isbSearchRequestIdRef.current === requestId) {
            setIsIsbSearching(false);
          }
        });
    }, SUBINPUT_SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [activeCategory, commandPaletteOpen, normalizedQuery, screenCommand, subInputCommand]);

  useEffect(() => {
    if (!commandPaletteOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (screenCommandId) {
          closeCommandScreen();
          return;
        }

        if (subInputCommandId) {
          exitSubInput();
          return;
        }

        if (activeCategory !== null) {
          if (normalizedQuery.length > 0) {
            setCommandPaletteQuery("");
            return;
          }

          setActiveCategory(null);
          return;
        }

        if (normalizedQuery.length > 0) {
          setCommandPaletteQuery("");
          return;
        }

        closeCommandPalette();
        return;
      }

      if (screenCommand) {
        if (event.key !== "Enter") {
          return;
        }

        const target = event.target;
        if (isEditableTarget(target)) {
          return;
        }

        event.preventDefault();
        if (commandNeedsForm(screenCommand)) {
          void handleSubmitCommandForm();
          return;
        }

        void executeCommand(screenCommand);
        return;
      }

      if (subInputCommand && subInputSpec) {
        const target = event.target;

        if (event.key === "Backspace" && target === inputRef.current && subInputValue.length === 0) {
          event.preventDefault();
          exitSubInput();
          return;
        }

        if (isExploitSearchSubInput && subInputSearchEntries.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          if (isEditableTarget(target) && target !== inputRef.current) {
            return;
          }

          event.preventDefault();
          const currentIndex = Math.max(
            subInputSearchEntries.findIndex((entry) => entry.exploitId === selectedSubInputSearchEntry?.exploitId),
            0,
          );
          const delta = event.key === "ArrowDown" ? 1 : -1;
          const nextIndex = (currentIndex + delta + subInputSearchEntries.length) % subInputSearchEntries.length;
          setSelectedSubInputSearchEntryId(subInputSearchEntries[nextIndex]?.exploitId ?? null);
          return;
        }

        if (event.key === "Enter") {
          if (isEditableTarget(target) && target !== inputRef.current) {
            return;
          }

          event.preventDefault();
          void handleSubmitCommandForm();
        }

        return;
      }

      if (isHomeMode) {
        const target = event.target;
        if (isEditableTarget(target) && target !== inputRef.current) {
          return;
        }

        if (homeCategories.length === 0) {
          return;
        }

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const currentIndex = Math.max(homeCategories.findIndex((category) => category.id === selectedHomeCategoryItem?.id), 0);
          const delta = event.key === "ArrowDown" ? 1 : -1;
          const nextIndex = (currentIndex + delta + homeCategories.length) % homeCategories.length;
          setSelectedHomeCategory(homeCategories[nextIndex]?.id ?? null);
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          if (selectedHomeCategoryItem) {
            openCategory(selectedHomeCategoryItem.id);
          }
        }

        return;
      }

      if (filteredItems.length === 0) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const target = event.target;
        if (isEditableTarget(target) && target !== inputRef.current) {
          return;
        }

        event.preventDefault();
        const currentIndex = Math.max(filteredItems.findIndex((item) => item.id === selectedItem?.id), 0);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = (currentIndex + delta + filteredItems.length) % filteredItems.length;
        setCommandPaletteSelectedCommandId(filteredItems[nextIndex]?.id ?? null);
        return;
      }

      if (event.key === "Enter") {
        const target = event.target;
        if (isEditableTarget(target) && target !== inputRef.current) {
          return;
        }

        event.preventDefault();
        void handlePrimaryAction(selectedItem);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activeCategory,
    closeCommandPalette,
    commandPaletteOpen,
    filteredItems,
    homeCategories,
    isHomeMode,
    normalizedQuery.length,
    screenCommand,
    screenCommandId,
    selectedItem,
    selectedSubInputSearchEntry,
    selectedHomeCategoryItem,
    setCommandPaletteQuery,
    setCommandPaletteSelectedCommandId,
    subInputSearchEntries,
    subInputCommand,
    subInputCommandId,
    subInputSpec,
    subInputValue.length,
  ]);

  if (!commandPaletteOpen) {
    return null;
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[210] flex items-start justify-center px-3 pb-4 pt-[5.5vh] md:px-4">
        <motion.button
          type="button"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
          onClick={closeCommandPalette}
          aria-label="Close command palette"
        />

        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 280, damping: 28, mass: 0.9 }}
          className="relative flex max-h-[66vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[16px] bg-[#101114]/97 shadow-[0_18px_56px_rgba(0,0,0,0.52)] backdrop-blur-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <AnimatePresence mode="wait" initial={false}>
            {screenCommand ? (
              <motion.div
                key={`screen-${screenCommand.id}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: "easeOut" }}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="flex items-center justify-between gap-2 border-b border-white/[0.05] px-3 py-2.5 md:px-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-white">{screenCommand.title}</p>
                    <p className="mt-0.5 truncate text-[9px] text-[#80808a]">{formatCommandMeta(screenCommand)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeCommandScreen}
                    className="shrink-0 rounded-[9px] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#9d9da6] transition hover:bg-white/[0.05] hover:text-white"
                  >
                    Back
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5 md:px-3.5">
                  <p className="truncate text-[10px] text-[#6f6f79]">{screenCommand.id}</p>
                  {screenCommand.description ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[#b0b0b7]">{screenCommand.description}</p>
                  ) : null}

                  {commandNeedsForm(screenCommand) ? (
                    <form
                      id={commandFormId}
                      className="mt-3 space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleSubmitCommandForm();
                      }}
                    >
                      {screenCommand.consoleParams.length === 0 && screenCommand.defaultParameterName ? (
                        <label className="block">
                          <span className="text-[10px] font-medium text-white">{screenCommand.defaultParameterName}</span>
                          <input
                            value={defaultParamValue}
                            onChange={(event) => setDefaultParamValue(event.target.value)}
                            placeholder="Value"
                            className="mt-1.5 w-full border-b border-white/[0.08] bg-transparent px-0 py-1.5 text-[11px] text-white outline-none placeholder:text-[#5f5f69]"
                          />
                        </label>
                      ) : null}

                      {screenCommand.consoleParams.map((param) => {
                        const currentValue = paramDrafts[param.name] ?? "";
                        const hint = [param.detail, param.example ? `example: ${param.example}` : ""]
                          .filter(Boolean)
                          .join(" · ");

                        if (param.values && param.values.length > 0) {
                          return (
                            <label key={param.name} className="block">
                              <span className="text-[10px] font-medium text-white">{param.name}{param.required ? " *" : ""}</span>
                              {hint ? <span className="mt-1 block text-[9px] text-[#75757f]">{hint}</span> : null}
                              <select
                                value={currentValue}
                                onChange={(event) => setParamDrafts((state) => ({ ...state, [param.name]: event.target.value }))}
                                className="mt-1.5 w-full border-b border-white/[0.08] bg-transparent px-0 py-1.5 text-[11px] text-white outline-none"
                              >
                                <option value="">Select</option>
                                {param.values.map((value) => (
                                  <option key={value} value={value}>{value}</option>
                                ))}
                              </select>
                            </label>
                          );
                        }

                        if (param.valueType === "boolean") {
                          return (
                            <label key={param.name} className="block">
                              <span className="text-[10px] font-medium text-white">{param.name}{param.required ? " *" : ""}</span>
                              {hint ? <span className="mt-1 block text-[9px] text-[#75757f]">{hint}</span> : null}
                              <select
                                value={currentValue}
                                onChange={(event) => setParamDrafts((state) => ({ ...state, [param.name]: event.target.value }))}
                                className="mt-1.5 w-full border-b border-white/[0.08] bg-transparent px-0 py-1.5 text-[11px] text-white outline-none"
                              >
                                <option value="">Select</option>
                                <option value="true">true</option>
                                <option value="false">false</option>
                              </select>
                            </label>
                          );
                        }

                        return (
                          <label key={param.name} className="block">
                            <span className="text-[10px] font-medium text-white">{param.name}{param.required ? " *" : ""}</span>
                            {hint ? <span className="mt-1 block text-[9px] text-[#75757f]">{hint}</span> : null}
                            <input
                              value={currentValue}
                              onChange={(event) => setParamDrafts((state) => ({ ...state, [param.name]: event.target.value }))}
                              placeholder={param.example ?? param.valueType ?? "value"}
                              className="mt-1.5 w-full border-b border-white/[0.08] bg-transparent px-0 py-1.5 text-[11px] text-white outline-none placeholder:text-[#5f5f69]"
                            />
                          </label>
                        );
                      })}
                    </form>
                    ) : null}

                  {runError ? (
                    <p className="mt-3 text-[10px] leading-relaxed text-rose-100">{runError}</p>
                  ) : null}

                  {runResult && runResult.commandId === screenCommand.id ? (
                    <div className="mt-3">
                      <div className="flex items-center justify-between gap-2.5">
                        <p className="text-[9px] uppercase tracking-[0.14em] text-[#7f7f88]">Last result</p>
                        <p className="text-[9px] uppercase tracking-[0.14em] text-[#7f7f88]">{runResult.durationMs} ms</p>
                      </div>
                      <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[#d9d9e0]">{formatResultPreview(runResult.result)}</pre>
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-white/[0.05] px-3 py-2.5 md:px-3.5">
                  <span className="truncate text-[9px] uppercase tracking-[0.14em] text-[#767680]">
                    {commandNeedsForm(screenCommand) ? "Enter submits current form" : "Enter runs current command"}
                  </span>
                  {commandNeedsForm(screenCommand) ? (
                    <button
                      type="submit"
                      form={commandFormId}
                      disabled={isRunning}
                      className="shrink-0 rounded-[9px] bg-white/[0.06] px-2 py-1.5 text-[10px] font-medium text-white transition hover:bg-white/[0.1] disabled:opacity-50"
                    >
                      {isRunning ? "Running..." : `Run ${screenCommand.title}`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { void executeCommand(screenCommand); }}
                      disabled={isRunning}
                      className="shrink-0 rounded-[9px] bg-white/[0.06] px-2 py-1.5 text-[10px] font-medium text-white transition hover:bg-white/[0.1] disabled:opacity-50"
                    >
                      {isRunning ? "Running..." : `Run ${screenCommand.title}`}
                    </button>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="command-browse"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: "easeOut" }}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="border-b border-white/[0.05] px-2.5 pb-2 pt-2.5 md:px-3">
                  <div className="flex items-center gap-2 rounded-[12px] px-2 py-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0 text-[#8b8b95]"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
                    {subInputCommand && subInputSpec ? (
                      <>
                        <span className="shrink-0 rounded-[8px] bg-white/[0.06] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#b6b6be]">
                          {subInputCommand.title}
                        </span>
                        <div className="h-3.5 w-px shrink-0 bg-white/[0.08]" />
                      </>
                    ) : null}
                    <input
                      ref={inputRef}
                      value={subInputCommand && subInputSpec ? subInputValue : commandPaletteQuery}
                      onChange={(event) => {
                        if (subInputCommand && subInputSpec) {
                          if (subInputSpec.mode === "default") {
                            setDefaultParamValue(event.target.value);
                            return;
                          }

                          setParamDrafts((state) => ({
                            ...state,
                            [subInputSpec.fieldName]: event.target.value,
                          }));
                          return;
                        }

                        setCommandPaletteQuery(event.target.value);
                      }}
                      placeholder={subInputCommand && subInputSpec
                        ? (subInputSpec.placeholder ?? subInputSpec.label)
                        : (activeCategory ? `Search ${activeCategory} commands` : "Search commands, sketchbooks, apps, files, notebook cells")}
                      className="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-[#666672]"
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto px-2 pb-2 pt-1.5">
                  {isHomeMode ? (
                    homeCategories.length > 0 ? homeCategories.map((category) => {
                      const isSelected = category.id === selectedHomeCategoryItem?.id;

                      return (
                        <button
                          key={category.id}
                          type="button"
                          onClick={() => setSelectedHomeCategory(category.id)}
                          onDoubleClick={() => openCategory(category.id)}
                          className={`mt-0.5 w-full rounded-[9px] px-2 py-1.5 text-left transition ${isSelected ? "bg-white/[0.07] text-white" : "text-[#d3d3da] hover:bg-white/[0.035] hover:text-white"}`}
                        >
                          <p className="truncate text-[11px] leading-relaxed">
                            <span className="font-medium">{category.label}</span>
                            <span className="px-1 text-[#5f5f69]">·</span>
                            <span className={isSelected ? "text-[#b4b4bc]" : "text-[#83838d]"}>{category.commandCount} command{category.commandCount === 1 ? "" : "s"}</span>
                          </p>
                        </button>
                      );
                    }) : (
                      <p className="px-2 py-6 text-[11px] text-[#8c8c95]">No categories available yet.</p>
                    )
                  ) : isCommandPaletteLoading && commandPaletteCommands.length === 0 ? (
                    <p className="px-2 py-6 text-[11px] text-[#8c8c95]">Loading commands...</p>
                  ) : commandPaletteError ? (
                    <p className="px-2 py-6 text-[11px] text-rose-200">{commandPaletteError}</p>
                  ) : subInputCommand && isExploitSearchSubInput ? (
                    subInputSearchError ? (
                      <p className="px-2 py-6 text-[11px] text-rose-200">{subInputSearchError}</p>
                    ) : subInputValue.trim().length === 0 ? (
                      <p className="px-2 py-6 text-[11px] text-[#8c8c95]">Type to search stored exploits.</p>
                    ) : isSubInputSearching && subInputSearchEntries.length === 0 ? (
                      <p className="px-2 py-6 text-[11px] text-[#8c8c95]">Searching exploits...</p>
                    ) : subInputSearchEntries.length > 0 ? (
                      subInputSearchEntries.map((entry) => {
                        const meta = formatExploitResultMeta(entry);
                        const isSelected = entry.exploitId === selectedSubInputSearchEntry?.exploitId;

                        return (
                          <button
                            key={entry.exploitId}
                            type="button"
                            onMouseEnter={() => setSelectedSubInputSearchEntryId(entry.exploitId)}
                            onClick={() => openExploitViewer(entry)}
                            className={`mt-0.5 w-full rounded-[9px] px-2 py-1.5 text-left transition ${
                              isSelected ? "bg-white/[0.07] text-white" : "text-[#d3d3da] hover:bg-white/[0.035] hover:text-white"
                            }`}
                          >
                            <p className="truncate text-[11px] leading-relaxed">
                              <span className="font-medium">{entry.exploitId}</span>
                              <span className="px-1 text-[#5f5f69]">·</span>
                              <span>{entry.title}</span>
                            </p>
                            {meta ? (
                              <p className={`mt-0.5 truncate text-[9px] ${isSelected ? "text-[#b4b4bc]" : "text-[#83838d]"}`}>{meta}</p>
                            ) : null}
                          </button>
                        );
                      })
                    ) : (
                      <p className="px-2 py-6 text-[11px] text-[#8c8c95]">No matching exploits yet.</p>
                    )
                  ) : filteredItems.length > 0 ? (
                    filteredItems.map((item) => {
                      const isSelected = item.id === selectedItem?.id;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            if (subInputCommandId && item.kind === "command" && subInputCommandId !== item.command.id) {
                              exitSubInput();
                            }
                            setCommandPaletteSelectedCommandId(item.id);
                          }}
                          onDoubleClick={() => { void handlePrimaryAction(item); }}
                          className={`mt-0.5 w-full rounded-[9px] px-2 py-1.5 text-left transition ${isSelected ? "bg-white/[0.07] text-white" : "text-[#d3d3da] hover:bg-white/[0.035] hover:text-white"}`}
                        >
                          <p className="truncate text-[11px] leading-relaxed">
                            <span className="font-medium">{item.title}</span>
                            <span className="px-1 text-[#5f5f69]">·</span>
                            <span className={isSelected ? "text-[#b4b4bc]" : "text-[#83838d]"}>{formatPaletteItemListSummary(item)}</span>
                          </p>
                        </button>
                      );
                    })
                  ) : isIsbSearching && normalizedQuery.length > 0 ? (
                    <p className="px-2 py-6 text-[11px] text-[#8c8c95]">Searching all sketchbooks...</p>
                  ) : isbSearchError ? (
                    <p className="px-2 py-6 text-[11px] text-rose-200">{isbSearchError}</p>
                  ) : (
                    <p className="px-2 py-6 text-[11px] text-[#8c8c95]">No matches in commands, sketchbooks, apps, current VM files or indexed notebook cells yet.</p>
                  )}
                </div>

                {subInputCommand && (runError || (runResult && runResult.commandId === subInputCommand.id)) ? (
                  <div className="border-t border-white/[0.05] px-3 py-2 md:px-3.5">
                    {runError ? (
                      <p className="text-[10px] leading-relaxed text-rose-100">{runError}</p>
                    ) : null}

                    {runResult && runResult.commandId === subInputCommand.id ? (
                      <div>
                        <div className="flex items-center justify-between gap-2.5">
                          <p className="text-[9px] uppercase tracking-[0.14em] text-[#7f7f88]">Last result</p>
                          <p className="text-[9px] uppercase tracking-[0.14em] text-[#7f7f88]">{runResult.durationMs} ms</p>
                        </div>
                        <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[#d9d9e0]">{formatResultPreview(runResult.result)}</pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="border-t border-white/[0.05] px-3 py-1.5 text-[8px] uppercase tracking-[0.14em] text-[#7a7a83] md:px-3.5">
                  <div className="flex items-center justify-between gap-2">
                    {isHomeMode ? (
                      <>
                        <span className="truncate">{selectedHomeCategoryItem ? `${selectedHomeCategoryItem.label} · ${selectedHomeCategoryItem.commandCount} commands` : `${homeCategories.length} categories`}</span>
                        <span className="shrink-0">↑↓ move · Enter open · Esc close</span>
                      </>
                    ) : subInputCommand && subInputSpec ? (
                      <>
                        <span className="truncate">
                          {isExploitSearchSubInput
                            ? `exploit search · ${subInputSearchEntries.length} match${subInputSearchEntries.length === 1 ? "" : "es"}`
                            : `subinput · ${subInputCommand.title} · ${subInputSpec.label}`}
                        </span>
                        <span className="shrink-0">
                          {isExploitSearchSubInput
                            ? "↑↓ move · Enter open · Backspace on empty exits"
                            : "Enter submit · Backspace on empty exits"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="truncate">
                          {activeCategory
                            ? `${activeCategory} · ${categoryScopedItems.length} result${categoryScopedItems.length === 1 ? "" : "s"}`
                            : isIsbSearching && normalizedQuery.length > 0
                              ? `searching sketchbooks · ${filteredItems.length} partial match${filteredItems.length === 1 ? "" : "es"}`
                              : `${filteredItems.length} match${filteredItems.length === 1 ? "" : "es"}`}
                        </span>
                        <span className="shrink-0">↑↓ move · Enter open · Esc back</span>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </AnimatePresence>
  );
});
