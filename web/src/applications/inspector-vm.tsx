import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  createRemoteVmInspectorStream,
  type RemoteVmExecutionTask,
  type RemoteVmInspectorNode,
  type RemoteVmInspectorNodeDetails,
  type RemoteVmInspectorRootGroup,
  type RemoteVmInspectorSnapshot,
  type RemoteVmInspectorStreamHandle,
} from "../api/client";
import { useInterfaceStore } from "../store/ui";
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
  ApplicationMetaRow,
  ApplicationMetric,
  ApplicationPanel,
  ApplicationSurface,
} from "./application-layout.tsx";

export const INSPECTOR_VM_APPLICATION_ID = "applications/inspector-vm";

const ERROR_REFRESH_MS = 4000;

type InspectorVmLayer = "state" | "execution" | "runtime";

export type InspectorVmInput = {
  sessionCode?: string | null;
  relativePath?: string | null;
  activeLayer?: InspectorVmLayer | null;
  activeTab?: string | null;
  selectedHandle?: string | null;
  snapshot?: RemoteVmInspectorSnapshot | null;
  error?: string | null;
};

function formatMegabytes(value: number): string {
  return `${value.toFixed(1)} MB`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRelativeTaskDuration(startedAt: string | null): string {
  if (!startedAt) {
    return "-";
  }

  const startedAtTime = new Date(startedAt).getTime();
  if (Number.isNaN(startedAtTime)) {
    return "-";
  }

  return formatDuration(Math.max(0, Date.now() - startedAtTime));
}

function createInspectorVmInstanceTitle(relativePath?: string | null, notebookTitle?: string | null): string {
  if (relativePath && relativePath.trim().length > 0) {
    return `Inspector VM · ${relativePath.trim()}`;
  }

  if (notebookTitle && notebookTitle.trim().length > 0) {
    return `Inspector VM · ${notebookTitle.trim()}`;
  }

  return "Inspector VM";
}

function pickInitialLayer(input: InspectorVmInput): InspectorVmLayer {
  if (input.activeLayer === "execution" || input.activeLayer === "runtime") {
    return input.activeLayer;
  }

  if (input.activeTab === "activity") {
    return "execution";
  }

  if (input.activeTab === "runtime") {
    return "runtime";
  }

  return "state";
}

function findInspectorRunningTask(snapshot: RemoteVmInspectorSnapshot | null): RemoteVmExecutionTask | null {
  if (!snapshot) {
    return null;
  }

  const preferredTask = snapshot.execution.tasks.find((task) => task.taskId === snapshot.execution.activeTaskId && task.status === "running");
  if (preferredTask) {
    return preferredTask;
  }

  return snapshot.execution.tasks.find((task) => task.status === "running") ?? null;
}

function findInspectorQueuedTask(snapshot: RemoteVmInspectorSnapshot | null): RemoteVmExecutionTask | null {
  if (!snapshot) {
    return null;
  }

  const queuedTasks = snapshot.execution.tasks.filter((task) => task.status === "queued");
  if (queuedTasks.length === 0) {
    return null;
  }

  return queuedTasks
    .slice()
    .sort((left, right) => {
      const leftPosition = left.queuePosition ?? Number.MAX_SAFE_INTEGER;
      const rightPosition = right.queuePosition ?? Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition;
    })[0] ?? null;
}

function pickInitialHandle(rootGroups: RemoteVmInspectorRootGroup[]): string | null {
  const bindingHandle = rootGroups.find((group) => group.id === "bindings")?.nodes[0]?.handle;
  if (bindingHandle) {
    return bindingHandle;
  }

  return rootGroups[0]?.nodes[0]?.handle ?? null;
}

function findInspectorNodeInTree(
  nodes: readonly RemoteVmInspectorNode[],
  handle: string,
  nodeDetailsByHandle: Record<string, RemoteVmInspectorNodeDetails>,
): RemoteVmInspectorNode | null {
  for (const node of nodes) {
    if (node.handle === handle) {
      return node;
    }

    const children = nodeDetailsByHandle[node.handle]?.children ?? [];
    const nestedNode = findInspectorNodeInTree(children, handle, nodeDetailsByHandle);
    if (nestedNode) {
      return nestedNode;
    }
  }

  return null;
}

function findInspectorNode(
  rootGroups: readonly RemoteVmInspectorRootGroup[],
  handle: string | null,
  nodeDetailsByHandle: Record<string, RemoteVmInspectorNodeDetails>,
): RemoteVmInspectorNode | null {
  if (!handle) {
    return null;
  }

  for (const group of rootGroups) {
    const node = findInspectorNodeInTree(group.nodes, handle, nodeDetailsByHandle);
    if (node) {
      return node;
    }
  }

  return null;
}

function describeNodeFlags(node: RemoteVmInspectorNode): string {
  if (!node.descriptor) {
    return "runtime node";
  }

  const flags = [
    node.descriptor.enumerable ? "enumerable" : "hidden",
    node.descriptor.configurable ? "configurable" : "sealed",
    node.descriptor.writable === null
      ? (node.descriptor.getter || node.descriptor.setter ? "accessor" : "readonly")
      : node.descriptor.writable
        ? "writable"
        : "readonly",
  ];
  return flags.join(" · ");
}

function Panel({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return <ApplicationPanel title={title} subtitle={subtitle} action={action}>{children}</ApplicationPanel>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <ApplicationMetric label={label} value={value} detail={detail} />;
}

function EmptyState({ text }: { text: string }) {
  return <ApplicationEmptyState text={text} />;
}

function LayerButton({ label, isActive, onClick }: { label: string; isActive: boolean; onClick: () => void }) {
  return (
    <ApplicationChoiceButton onClick={onClick} isActive={isActive} className="px-3 font-medium">
      {label}
    </ApplicationChoiceButton>
  );
}

function InspectorInlineNodeDetails({
  node,
  nodeDetails,
  nodeError,
}: {
  node: RemoteVmInspectorNode;
  nodeDetails: RemoteVmInspectorNodeDetails | null;
  nodeError: string | null;
}) {
  return (
    <div className="ml-5 mt-1.5 border-l border-white/[0.06] pl-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-[#8d8d96]">
        <span>{node.type}</span>
        {node.constructorName ? <span>{node.constructorName}</span> : null}
        <span>{node.childCount !== null ? `${node.childCount} children` : "0 children"}</span>
        <span>{node.originCellId ?? "runtime"}</span>
      </div>

      <pre className="mt-2 whitespace-pre-wrap bg-white/[0.03] px-3 py-2.5 font-mono text-[11px] leading-6 text-[#ececf2]">{node.preview}</pre>

      {nodeError ? (
        <div className="mt-2 rounded-[8px] bg-amber-500/[0.08] px-2.5 py-2 text-[11px] text-amber-100">{nodeError}</div>
      ) : null}

      {nodeDetails?.path && nodeDetails.path.length > 1 ? (
        <div className="mt-2 font-mono text-[10px] text-[#8f9098]">
          {nodeDetails.path.map((entry) => entry.label).join(" > ")}
        </div>
      ) : null}
    </div>
  );
}

type InspectorExecutionEntry = {
  id: string;
  label: string;
  subtitle: string;
  preview: string;
  meta: string[];
  task?: RemoteVmExecutionTask;
  logs?: readonly string[];
  logLineCount?: number;
};

function InspectorExecutionInlineDetails({
  entry,
  isCancelling,
  onCancelTask,
}: {
  entry: InspectorExecutionEntry;
  isCancelling: boolean;
  onCancelTask: (taskId: string) => void;
}) {
  const task = entry.task ?? null;
  const logLines = entry.logs ?? [];
  const logLineCount = entry.logLineCount ?? logLines.length;
  const canCancel = Boolean(task && (task.status === "queued" || task.status === "running"));
  const cancelDisabled = !task || isCancelling || task.cancelRequested;

  return (
    <div className="ml-5 mt-1.5 border-l border-white/[0.06] pl-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-[#8d8d96]">
          {entry.meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        {canCancel && task ? (
          <button
            type="button"
            onClick={() => onCancelTask(task.taskId)}
            disabled={cancelDisabled}
            className="cursor-pointer rounded-[8px] bg-white/[0.08] px-2.5 py-1 font-mono text-[10px] text-[#ececf2] transition hover:bg-white/[0.12] hover:text-white disabled:cursor-default disabled:opacity-50"
          >
            {task.cancelRequested || isCancelling ? "Stopping" : "Stop task"}
          </button>
        ) : null}
      </div>
      <pre className="mt-2 whitespace-pre-wrap bg-white/[0.03] px-3 py-2.5 font-mono text-[11px] leading-6 text-[#ececf2]">{entry.preview}</pre>
      {task ? (
        <div className="mt-2">
          <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] text-[#8d8d96]">
            <span>{logLineCount > logLines.length ? `log tail ${logLines.length}/${logLineCount}` : `${logLineCount} log lines`}</span>
            {task.cancelRequested ? <span>cancel requested</span> : null}
          </div>
          {logLines.length > 0 ? (
            <pre className="dense-scroll mt-2 max-h-56 overflow-auto whitespace-pre-wrap bg-black/20 px-3 py-2.5 font-mono text-[11px] leading-5 text-[#d6d7dc]">{logLines.join("\n")}</pre>
          ) : (
            <div className="mt-2 font-mono text-[10px] text-[#8f9098]">{task.status === "queued" ? "Task has not produced logs yet." : "No task logs captured yet."}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function InspectorExecutionTreeNode({
  entry,
  selectedEntryId,
  onSelect,
  onCancelTask,
  cancellingTaskIds,
}: {
  entry: InspectorExecutionEntry;
  selectedEntryId: string | null;
  onSelect: (entryId: string) => void;
  onCancelTask: (taskId: string) => void;
  cancellingTaskIds: Record<string, boolean>;
}) {
  const isSelected = selectedEntryId === entry.id;
  const isCancelling = entry.task ? cancellingTaskIds[entry.task.taskId] === true : false;

  return (
    <div>
      <div className="relative">
        <div className={`flex items-center gap-1 px-1.5 py-0.5 text-left transition ${isSelected ? "text-white" : "text-[#d2d2d8] hover:text-white"}`}>
          <span className="h-4 w-4 shrink-0 text-[10px] text-[#8d8d96]">·</span>
          <button type="button" onClick={() => onSelect(entry.id)} className="min-w-0 flex-1 cursor-pointer text-left">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="truncate font-mono text-[11px] text-[#ececf2]">{entry.label}</span>
              <span className="max-w-[60%] truncate text-right text-[10px] text-[#8f9098]">{entry.subtitle}</span>
            </div>
          </button>
        </div>
      </div>
      {isSelected ? <InspectorExecutionInlineDetails entry={entry} isCancelling={isCancelling} onCancelTask={onCancelTask} /> : null}
    </div>
  );
}

function InspectorExecutionTreeSection({
  title,
  entries,
  selectedEntryId,
  onSelect,
  onCancelTask,
  cancellingTaskIds,
  emptyText,
}: {
  title: string;
  entries: readonly InspectorExecutionEntry[];
  selectedEntryId: string | null;
  onSelect: (entryId: string) => void;
  onCancelTask: (taskId: string) => void;
  cancellingTaskIds: Record<string, boolean>;
  emptyText: string;
}) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#7d7d86]">{title}</div>
      {entries.length > 0 ? (
        <div className="relative ml-3 mt-0.5 space-y-0.5 pl-4">
          <span className="absolute bottom-0 left-0 top-0 w-px bg-white/[0.08]" />
          {entries.map((entry) => (
            <InspectorExecutionTreeNode
              key={entry.id}
              entry={entry}
              selectedEntryId={selectedEntryId}
              onSelect={onSelect}
              onCancelTask={onCancelTask}
              cancellingTaskIds={cancellingTaskIds}
            />
          ))}
        </div>
      ) : (
        <EmptyState text={emptyText} />
      )}
    </div>
  );
}

function InspectorTreeGroup({
  group,
  selectedHandle,
  expandedHandles,
  loadingHandles,
  nodeDetailsByHandle,
  onSelect,
  onToggleNode,
  nodeError,
}: {
  group: RemoteVmInspectorRootGroup;
  selectedHandle: string | null;
  expandedHandles: Record<string, boolean>;
  loadingHandles: Record<string, boolean>;
  nodeDetailsByHandle: Record<string, RemoteVmInspectorNodeDetails>;
  onSelect: (node: RemoteVmInspectorNode) => void;
  onToggleNode: (node: RemoteVmInspectorNode) => void;
  nodeError: string | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 px-1.5 py-1 text-left">
        <span className="h-4 w-4 shrink-0 rounded text-[10px] text-[#8d8d96]">▾</span>
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#7d7d86]">{group.title}</span>
      </div>
      <div className="relative ml-3 mt-0.5 space-y-0.5 pl-4">
        <span className="absolute bottom-0 left-0 top-0 w-px bg-white/[0.08]" />
        {group.nodes.map((node) => (
          <InspectorTreeNode
            key={node.handle}
            node={node}
            depth={0}
            selectedHandle={selectedHandle}
            expandedHandles={expandedHandles}
            loadingHandles={loadingHandles}
            nodeDetailsByHandle={nodeDetailsByHandle}
            onSelect={onSelect}
            onToggle={onToggleNode}
            nodeError={nodeError}
          />
        ))}
      </div>
    </div>
  );
}

function InspectorTreeNode({
  node,
  depth,
  selectedHandle,
  expandedHandles,
  loadingHandles,
  nodeDetailsByHandle,
  onSelect,
  onToggle,
  nodeError,
}: {
  node: RemoteVmInspectorNode;
  depth: number;
  selectedHandle: string | null;
  expandedHandles: Record<string, boolean>;
  loadingHandles: Record<string, boolean>;
  nodeDetailsByHandle: Record<string, RemoteVmInspectorNodeDetails>;
  onSelect: (node: RemoteVmInspectorNode) => void;
  onToggle: (node: RemoteVmInspectorNode) => void;
  nodeError: string | null;
}) {
  const isSelected = node.handle === selectedHandle;
  const isExpanded = expandedHandles[node.handle] === true;
  const children = nodeDetailsByHandle[node.handle]?.children ?? [];
  const isLoading = loadingHandles[node.handle] === true;
  const inlineNodeDetails = nodeDetailsByHandle[node.handle] ?? null;
  const showInlineDetails = isSelected || isExpanded;

  return (
    <div>
      <div className="relative">
        {depth > 0 ? <span className="absolute left-0 top-[14px] h-px w-3 bg-white/[0.12]" /> : null}
        <div className={`flex items-center gap-1 px-1.5 py-0.5 text-left transition ${isSelected ? "text-white" : "text-[#d2d2d8] hover:text-white"} ${depth > 0 ? "pl-4" : ""}`}>
          <button
            type="button"
            onClick={() => onToggle(node)}
            className={`h-4 w-4 shrink-0 cursor-pointer text-[10px] text-[#8d8d96] ${node.expandable ? "hover:text-white" : "opacity-40"}`}
          >
            {node.expandable ? (isExpanded ? "▾" : "▸") : "·"}
          </button>
          <button type="button" onClick={() => onSelect(node)} className="min-w-0 flex-1 cursor-pointer text-left">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="truncate font-mono text-[11px] text-[#ececf2]">{node.name}</span>
              <div className="flex min-w-0 max-w-[68%] items-center gap-2 text-[10px] text-[#8f9098]">
                <span className="shrink-0 text-[9px] uppercase tracking-[0.14em] text-[#a6a6af]">{node.type}</span>
                <span className="truncate text-right">{node.preview}</span>
              </div>
            </div>
          </button>
        </div>
      </div>
      {showInlineDetails ? (
        <InspectorInlineNodeDetails
          node={node}
          nodeDetails={inlineNodeDetails}
          nodeError={selectedHandle === node.handle ? nodeError : null}
        />
      ) : null}
      {isExpanded ? (
        <div className="relative ml-3 mt-0.5 space-y-0.5 pl-4">
          <span className="absolute bottom-0 left-0 top-0 w-px bg-white/[0.08]" />
          {children.map((child) => (
            <InspectorTreeNode
              key={child.handle}
              node={child}
              depth={depth + 1}
              selectedHandle={selectedHandle}
              expandedHandles={expandedHandles}
              loadingHandles={loadingHandles}
              nodeDetailsByHandle={nodeDetailsByHandle}
              onSelect={onSelect}
              onToggle={onToggle}
              nodeError={nodeError}
            />
          ))}
          {isLoading ? <div className="pl-4 text-[10px] text-[#8d8d96]">Loading…</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function InspectorVmApp({ instance, setTitle }: ApplicationViewProps<InspectorVmInput>) {
  const updateApplicationInstanceInput = useInterfaceStore((state) => state.updateApplicationInstanceInput);
  const sessionCode = instance.input.sessionCode?.trim() ?? "";
  const [snapshot, setSnapshot] = useState<RemoteVmInspectorSnapshot | null>(instance.input.snapshot ?? null);
  const [rootGroups, setRootGroups] = useState<RemoteVmInspectorRootGroup[]>([]);
  const [nodeDetailsByHandle, setNodeDetailsByHandle] = useState<Record<string, RemoteVmInspectorNodeDetails>>({});
  const [loadingHandles, setLoadingHandles] = useState<Record<string, boolean>>({});
  const [selectedHandle, setSelectedHandle] = useState<string | null>(instance.input.selectedHandle ?? null);
  const [expandedHandles, setExpandedHandles] = useState<Record<string, boolean>>({});
  const [selectedExecutionEntryId, setSelectedExecutionEntryId] = useState<string | null>(null);
  const [cancellingTaskIds, setCancellingTaskIds] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(instance.input.error ?? null);
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<InspectorVmLayer>(pickInitialLayer(instance.input));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const inspectorStreamRef = useRef<RemoteVmInspectorStreamHandle | null>(null);
  const selectedHandleRef = useRef<string | null>(selectedHandle);

  useEffect(() => {
    selectedHandleRef.current = selectedHandle;
  }, [selectedHandle]);

  const relativePath = useMemo(
    () => instance.input.relativePath?.trim() || snapshot?.relativePath || "",
    [instance.input.relativePath, snapshot?.relativePath],
  );

  const activeEvaluation = snapshot?.activeEvaluation ?? null;
  const activeTask = findInspectorRunningTask(snapshot);
  const queuedTask = findInspectorQueuedTask(snapshot);
  const currentTask = activeTask ?? queuedTask;
  const useActiveEvaluationSource = activeEvaluation !== null
    && (activeTask === null || activeTask.taskId === activeEvaluation.taskId);
  const taskSourcePreview = useActiveEvaluationSource
    ? activeEvaluation.sourcePreview
    : currentTask?.sourcePreview ?? null;
  const taskSourceLineCount = useActiveEvaluationSource
    ? activeEvaluation.sourceLineCount
    : currentTask?.sourceLineCount ?? null;
  const recentCellResults = snapshot?.recentCellResults ?? [];
  const workers = snapshot?.backgroundWorkers ?? [];
  const runtimeKits = snapshot?.runtimeKits ?? [];
  const selectedNode = findInspectorNode(rootGroups, selectedHandle, nodeDetailsByHandle);
  const currentExecutionEntries = currentTask ? [{
    id: `current:${currentTask.taskId}`,
    label: currentTask.cellId ?? currentTask.taskId,
    subtitle: `${currentTask.language} · ${currentTask.status}`,
    preview: taskSourcePreview ?? currentTask.sourcePreview,
    meta: [
      currentTask.language,
      currentTask.status,
      `${taskSourceLineCount ?? currentTask.sourceLineCount} lines`,
      currentTask.startedAt ? `started ${formatTimestamp(currentTask.startedAt)}` : `queued ${formatTimestamp(currentTask.queuedAt)}`,
      currentTask.logLineCount > 0 ? `${currentTask.logLineCount} logs` : "no logs yet",
      currentTask.cancelRequested ? "cancel requested" : "stop available",
      currentTask.previousCellId ? `prev ${currentTask.previousCellId}` : "no previous cell",
    ],
    task: currentTask,
    logs: currentTask.logs,
    logLineCount: currentTask.logLineCount,
  } satisfies InspectorExecutionEntry] : [];
  const queueExecutionEntries = snapshot?.execution.tasks
    .filter((task) => task.taskId !== currentTask?.taskId)
    .map((task) => ({
    id: `queue:${task.taskId}`,
    label: task.cellId ?? task.taskId,
    subtitle: `${task.language} · ${task.status}`,
    preview: task.sourcePreview,
    meta: [
      task.language,
      task.status,
      `${task.sourceLineCount} lines`,
      task.queuePosition !== null ? `pos ${task.queuePosition}` : "active",
      task.logLineCount > 0 ? `${task.logLineCount} logs` : "no logs yet",
      task.cancelRequested ? "cancel requested" : (task.status === "queued" || task.status === "running") ? "stop available" : "retained",
      task.startedAt ? formatTimestamp(task.startedAt) : formatTimestamp(task.queuedAt),
    ],
    task,
    logs: task.logs,
    logLineCount: task.logLineCount,
    } satisfies InspectorExecutionEntry)) ?? [];
  const recentExecutionEntries = recentCellResults.map((entry) => ({
    id: `recent:${entry.cellId}:${entry.executedAt}`,
    label: entry.cellId,
    subtitle: `${entry.language} · ${formatTimestamp(entry.executedAt)}`,
    preview: entry.preview,
    meta: [entry.language, formatTimestamp(entry.executedAt)],
  } satisfies InspectorExecutionEntry));

  useEffect(() => {
    setTitle(createInspectorVmInstanceTitle(relativePath, snapshot?.notebookTitle));
  }, [relativePath, setTitle, snapshot?.notebookTitle]);

  useEffect(() => {
    updateApplicationInstanceInput(instance.instanceId, {
      sessionCode: sessionCode || null,
      relativePath: relativePath || null,
      activeLayer,
      selectedHandle,
      snapshot,
      error,
    } satisfies InspectorVmInput);
  }, [activeLayer, error, instance.instanceId, relativePath, selectedHandle, sessionCode, snapshot, updateApplicationInstanceInput]);

  useEffect(() => {
    if (sessionCode.length === 0) {
      inspectorStreamRef.current?.close();
      inspectorStreamRef.current = null;
      setSnapshot(null);
      setRootGroups([]);
      setSelectedHandle(null);
      setNodeDetailsByHandle({});
      setLoadingHandles({});
      setExpandedHandles({});
      setNodeError(null);
      setError("Current notebook does not have an active VM session yet.");
      return;
    }

    let disposed = false;
    let reconnectTimerId: number | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimerId !== null) {
        return;
      }

      reconnectTimerId = window.setTimeout(() => {
        reconnectTimerId = null;
        setRefreshNonce((value) => value + 1);
      }, ERROR_REFRESH_MS);
    };

    setIsRefreshing(true);
    setError(null);
    setNodeError(null);
    setLoadingHandles({});

    const stream = createRemoteVmInspectorStream(sessionCode, {
      onClose: () => {
        if (disposed) {
          return;
        }

        setIsRefreshing(false);
        setError((currentError) => currentError ?? "Inspector stream closed.");
        scheduleReconnect();
      },
      onError: () => {
        if (disposed) {
          return;
        }

        setIsRefreshing(false);
        setError((currentError) => currentError ?? "Inspector stream failed to connect.");
        scheduleReconnect();
      },
      onEvent: (event) => {
        if (disposed) {
          return;
        }

        if (event.type === "ready") {
          return;
        }

        if (event.type === "state") {
          clearReconnectTimer();
          setSnapshot(event.snapshot);
          setRootGroups(event.rootGroups);
          setError(null);
          setIsRefreshing(false);
          setSelectedHandle((currentHandle) => currentHandle ?? pickInitialHandle(event.rootGroups));
          return;
        }

        if (event.type === "node") {
          setNodeDetailsByHandle((state) => ({
            ...state,
            [event.handle]: event.details,
          }));
          setLoadingHandles((state) => ({
            ...state,
            [event.handle]: false,
          }));
          setNodeError((currentError) => selectedHandleRef.current === event.handle ? null : currentError);
          return;
        }

        if (event.type === "node-error") {
          setLoadingHandles((state) => ({
            ...state,
            [event.handle]: false,
          }));
          setNodeError((currentError) => selectedHandleRef.current === event.handle ? event.error : currentError);
          return;
        }

        if (event.type === "cancel-ack") {
          if (!event.accepted) {
            setCancellingTaskIds((state) => {
              if (!state[event.taskId]) {
                return state;
              }

              const nextState = { ...state };
              delete nextState[event.taskId];
              return nextState;
            });
            setError(event.message ?? `Unable to stop task ${event.taskId}.`);
          }
          return;
        }

        setError(event.error);
        setIsRefreshing(false);
      },
    });
    inspectorStreamRef.current = stream;

    return () => {
      disposed = true;
      clearReconnectTimer();
      if (inspectorStreamRef.current === stream) {
        inspectorStreamRef.current = null;
      }
      stream.close();
    };
  }, [refreshNonce, sessionCode]);

  useEffect(() => {
    if (sessionCode.length === 0 || !selectedHandle) {
      setNodeError(null);
      return;
    }

    setLoadingHandles((state) => ({ ...state, [selectedHandle]: true }));
    inspectorStreamRef.current?.requestNode(selectedHandle);
  }, [selectedHandle, sessionCode, snapshot?.inspectedAt]);

  useEffect(() => {
    if (!snapshot) {
      setCancellingTaskIds((state) => (Object.keys(state).length > 0 ? {} : state));
      return;
    }

    setCancellingTaskIds((state) => {
      let changed = false;
      const nextState = { ...state };

      for (const taskId of Object.keys(state)) {
        const task = snapshot.execution.tasks.find((entry) => entry.taskId === taskId) ?? null;
        if (!task || task.cancelRequested || (task.status !== "queued" && task.status !== "running")) {
          delete nextState[taskId];
          changed = true;
        }
      }

      return changed ? nextState : state;
    });
  }, [snapshot]);

  useEffect(() => {
    const availableEntryIds = [
      ...currentExecutionEntries.map((entry) => entry.id),
      ...queueExecutionEntries.map((entry) => entry.id),
      ...recentExecutionEntries.map((entry) => entry.id),
    ];

    setSelectedExecutionEntryId((currentEntryId) => {
      if (currentEntryId && availableEntryIds.includes(currentEntryId)) {
        return currentEntryId;
      }

      return availableEntryIds[0] ?? null;
    });
  }, [currentExecutionEntries, queueExecutionEntries, recentExecutionEntries]);

  const handleSelectNode = (node: RemoteVmInspectorNode) => {
    setSelectedHandle(node.handle);
  };

  const handleToggleNode = (node: RemoteVmInspectorNode) => {
    setSelectedHandle(node.handle);
    if (!node.expandable) {
      return;
    }

    setExpandedHandles((state) => ({
      ...state,
      [node.handle]: !state[node.handle],
    }));
  };

  const handleCancelTask = (taskId: string) => {
    const stream = inspectorStreamRef.current;
    if (!stream) {
      setError("Inspector stream is not connected.");
      return;
    }

    setCancellingTaskIds((state) => state[taskId] ? state : ({
      ...state,
      [taskId]: true,
    }));
    stream.cancelTask(taskId);
  };

  return (
    <ApplicationSurface>
      <ApplicationHeader
        title="Inspector VM"
        subtitle={relativePath || sessionCode || "Notebook runtime inspector"}
        actions={(
          <ApplicationActionButton onClick={() => setRefreshNonce((value) => value + 1)} className="py-1">
            {isRefreshing ? "Refreshing" : "Refresh"}
          </ApplicationActionButton>
        )}
        alert={error ? <ApplicationAlert>{error}</ApplicationAlert> : undefined}
        meta={(
          <>
            <ApplicationMetaRow>
              <span>vm {activeTask ? "running" : queuedTask ? `queue ${queuedTask.queuePosition ?? "-"}` : snapshot?.vm.prepared ? "ready" : "idle"}</span>
              <span>bindings {snapshot ? snapshot.vm.userBindingCount : 0}</span>
              <span>cells {snapshot ? snapshot.vm.persistedCellCount : 0}</span>
              <span>heap {snapshot ? formatMegabytes(snapshot.memoryUsage.heapUsedMb) : "-"}</span>
              {selectedNode?.originCellId ? <span>origin {selectedNode.originCellId}</span> : null}
            </ApplicationMetaRow>
            <div className="mt-2 flex items-center gap-1 rounded-[12px] bg-black/20 p-1">
              <LayerButton label="JS State" isActive={activeLayer === "state"} onClick={() => setActiveLayer("state")} />
              <LayerButton label="Execution" isActive={activeLayer === "execution"} onClick={() => setActiveLayer("execution")} />
              <LayerButton label="Runtime" isActive={activeLayer === "runtime"} onClick={() => setActiveLayer("runtime")} />
            </div>
          </>
        )}
        className="border-b border-white/[0.06]"
      />

      {activeLayer === "state" ? (
        <div className="min-h-0 flex-1 pt-2">
          <Panel title="Objects">
            <div className="space-y-2">
              {rootGroups.length > 0 ? rootGroups.map((group) => (
                <InspectorTreeGroup
                  key={group.id}
                  group={group}
                  selectedHandle={selectedHandle}
                  expandedHandles={expandedHandles}
                  loadingHandles={loadingHandles}
                  nodeDetailsByHandle={nodeDetailsByHandle}
                  onSelect={handleSelectNode}
                  onToggleNode={handleToggleNode}
                  nodeError={nodeError}
                />
              )) : (
                <EmptyState text="No inspector roots are visible yet. Run a cell that initializes bindings and then refresh this layer." />
              )}
            </div>
          </Panel>
        </div>
      ) : activeLayer === "execution" ? (
        <div className="min-h-0 flex-1 pt-2">
          <Panel title="Execution">
            <div className="space-y-3">
              <InspectorExecutionTreeSection
                title="Current"
                entries={currentExecutionEntries}
                selectedEntryId={selectedExecutionEntryId}
                onSelect={setSelectedExecutionEntryId}
                onCancelTask={handleCancelTask}
                cancellingTaskIds={cancellingTaskIds}
                emptyText="Execution is currently idle."
              />
              <InspectorExecutionTreeSection
                title="Queue"
                entries={queueExecutionEntries}
                selectedEntryId={selectedExecutionEntryId}
                onSelect={setSelectedExecutionEntryId}
                onCancelTask={handleCancelTask}
                cancellingTaskIds={cancellingTaskIds}
                emptyText="No queued or retained execution tasks are visible for this notebook session."
              />
              <InspectorExecutionTreeSection
                title="Recent Results"
                entries={recentExecutionEntries}
                selectedEntryId={selectedExecutionEntryId}
                onSelect={setSelectedExecutionEntryId}
                onCancelTask={handleCancelTask}
                cancellingTaskIds={cancellingTaskIds}
                emptyText="No cached results yet."
              />
            </div>
          </Panel>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 pt-2">
          <Panel title="Host Memory">
            {snapshot ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <Metric label="RSS" value={formatMegabytes(snapshot.memoryUsage.rssMb)} />
                <Metric label="Heap Used" value={formatMegabytes(snapshot.memoryUsage.heapUsedMb)} />
                <Metric label="Heap Total" value={formatMegabytes(snapshot.memoryUsage.heapTotalMb)} />
                <Metric label="External" value={formatMegabytes(snapshot.memoryUsage.externalMb)} />
                <Metric label="Array Buffers" value={formatMegabytes(snapshot.memoryUsage.arrayBuffersMb)} />
              </div>
            ) : (
              <EmptyState text="Waiting for VM memory snapshot…" />
            )}
          </Panel>

          <Panel title="Runtime Workers">
            {workers.length > 0 ? (
              <div className="grid gap-2 lg:grid-cols-2">
                {workers.map((worker) => (
                  <div key={worker.id} className="border-t border-white/[0.06] px-0 py-2.5 first:border-t-0">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[12px] font-medium text-[#ececf2]">{worker.name}</div>
                        <div className="mt-0.5 font-mono text-[9px] text-[#8f9098]">{worker.relativeScriptPath}</div>
                      </div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#d8d8df]">{worker.status}</div>
                    </div>
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2 text-[10px] text-[#9ea1ab]">
                      <div>PID {worker.pid}</div>
                      <div>{worker.uptimeSeconds !== null ? `${Math.round(worker.uptimeSeconds)}s uptime` : "No metrics yet"}</div>
                      <div>{worker.memoryUsage ? `rss ${worker.memoryUsage.rssMb.toFixed(1)} MB` : "Memory pending"}</div>
                      <div>{worker.lastEvent || worker.lastLog || "No recent events"}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No background workers are currently visible in the shared runtime." />
            )}
          </Panel>

          <Panel title="Attached Kits">
            {runtimeKits.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {runtimeKits.map((kit) => (
                  <div key={kit.id} className="border-t border-white/[0.06] px-0 py-2.5 first:border-t-0">
                    <div className="text-[12px] font-medium text-[#ececf2]">{kit.name}</div>
                    <div className="mt-0.5 font-mono text-[9px] text-[#8f9098]">{kit.id}</div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-[#a4a7b0]">
                      <span>{kit.category ?? "uncategorized"}</span>
                      <span className="uppercase tracking-[0.16em] text-[#d8d9df]">{kit.active ? "active" : "idle"}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No kits are attached to the shared runtime right now." />
            )}
          </Panel>
        </div>
      )}
    </ApplicationSurface>
  );
}

export const inspectorVmApplication = defineApplication<InspectorVmInput>({
  id: INSPECTOR_VM_APPLICATION_ID,
  title: "Inspector VM",
  View: InspectorVmApp,
  getInitialTitle: (input) => createInspectorVmInstanceTitle(input.relativePath),
});

export { createInspectorVmInstanceTitle };