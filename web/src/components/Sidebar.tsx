import { type DragEvent, type ReactNode, useEffect, useMemo, useState, memo } from "react";
import { useInterfaceStore } from "../store/ui";
import { useShallow } from "zustand/react/shallow";
import type { ApplicationInstance } from "../applications/application";
import {
  AI_AGENT_APPLICATION_ID,
  CLOAK_BROWSERS_APPLICATION_ID,
  CRAWL_AUDIT_APPLICATION_ID,
  INSPECTOR_VM_APPLICATION_ID,
  PORT_SCAN_APPLICATION_ID,
  POSTMAN_APPLICATION_ID,
  ZOOMEYE_APPLICATION_ID,
  createCloakBrowsersInstanceTitle,
  createInspectorVmInstanceTitle,
} from "../applications";
import { type WorkspaceTreeNode } from "../data";
import { getFileIcon } from "../file-icons";
import {
  buildWorkspaceTree,
  getNotebookDirectory,
  getNotebookLabel,
  sanitizeNotebookOrderState,
  sortNotebookPaths,
} from "../notebook-tree";

const SIDEBAR_ROW_CLASS = "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.25 text-left transition hover:bg-white/[0.05]";
const SIDEBAR_NESTED_LIST_CLASS = "mt-0.5 space-y-px pl-3";

function ProjectLogo() {
  return (
    <div className="min-w-0 px-1">
      <div className="truncate text-[15px] font-semibold tracking-[0.01em] text-[#f5f5f5]">iscan</div>
    </div>
  );
}

function PanelCollapseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Collapse workspace panel"
      aria-label="Collapse workspace panel"
      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-xl text-[#7d7d86] transition hover:bg-white/[0.08] hover:text-white"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 rotate-180" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}

function ChevronIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`h-4 w-4 shrink-0 text-[#71717a] transition-transform ${isExpanded ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function DragHandleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 12 12"
      fill="currentColor"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <circle cx="3" cy="2.25" r="0.9" />
      <circle cx="3" cy="6" r="0.9" />
      <circle cx="3" cy="9.75" r="0.9" />
      <circle cx="9" cy="2.25" r="0.9" />
      <circle cx="9" cy="6" r="0.9" />
      <circle cx="9" cy="9.75" r="0.9" />
    </svg>
  );
}

function getFolderIcon(label: string, isOpen: boolean) {
  return isOpen ? '/icons/_folder_open.svg' : '/icons/_folder.svg';
}

type NotebookDropPosition = "before" | "after" | "inside";

type NotebookDragState = {
  draggedFileId: string;
  targetNodeId: string | null;
  position: NotebookDropPosition | null;
};

type TreeNodeDragProps = {
  draggedFileId: string | null;
  dropTargetNodeId: string | null;
  dropTargetPosition: NotebookDropPosition | null;
  onFileDragStart: (event: DragEvent<HTMLButtonElement>, fileId: string) => void;
  onFileDragEnd: () => void;
  onFileDragOver: (event: DragEvent<HTMLButtonElement>, fileId: string) => void;
  onFileDrop: (event: DragEvent<HTMLButtonElement>, fileId: string) => void;
  onFolderDragOver: (event: DragEvent<HTMLButtonElement>, folderPath: string) => void;
  onFolderDrop: (event: DragEvent<HTMLButtonElement>, folderPath: string) => void;
};

function getFolderPath(node: WorkspaceTreeNode): string {
  return node.id.startsWith("folder:") ? node.id.slice("folder:".length) : "";
}

function joinDraggedNotebookPath(directoryPath: string, fileId: string): string {
  const label = getNotebookLabel(fileId);
  return directoryPath.length > 0 ? `${directoryPath}/${label}` : label;
}

function areNotebookOrderStatesEqual(left: Record<string, string[]>, right: Record<string, string[]>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key, index) => {
    if (key !== rightKeys[index]) {
      return false;
    }

    const leftPaths = left[key] ?? [];
    const rightPaths = right[key] ?? [];
    if (leftPaths.length !== rightPaths.length) {
      return false;
    }

    return leftPaths.every((path, pathIndex) => path === rightPaths[pathIndex]);
  });
}

const FolderItem = memo(({
  node,
  depth,
  isDropInside,
  draggedFileId,
  dropTargetNodeId,
  dropTargetPosition,
  onFileDragStart,
  onFileDragEnd,
  onFileDragOver,
  onFileDrop,
  onDragOver,
  onDrop,
}: {
  node: WorkspaceTreeNode;
  depth: number;
  isDropInside: boolean;
  draggedFileId: string | null;
  dropTargetNodeId: string | null;
  dropTargetPosition: NotebookDropPosition | null;
  onFileDragStart: (event: DragEvent<HTMLButtonElement>, fileId: string) => void;
  onFileDragEnd: () => void;
  onFileDragOver: (event: DragEvent<HTMLButtonElement>, fileId: string) => void;
  onFileDrop: (event: DragEvent<HTMLButtonElement>, fileId: string) => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>, folderPath: string) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>, folderPath: string) => void;
}) => {
  const isExpanded = useInterfaceStore((state) => state.expandedFolderIds.includes(node.id));
  const toggleFolder = useInterfaceStore((state) => state.toggleFolder);
  const openContextMenu = useInterfaceStore((state) => state.openContextMenu);
  const createNotebookInFolder = useInterfaceStore((state) => state.createNotebookInFolder);
  const createNotebookFolder = useInterfaceStore((state) => state.createNotebookFolder);
  const folderPath = getFolderPath(node);

  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => toggleFolder(node.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openContextMenu({
            x: event.clientX,
            y: event.clientY,
            items: [{
              id: `create-notebook-${folderPath}`,
              label: "New notebook here",
              tone: "accent",
              onSelect: async () => {
                const notebookName = typeof globalThis.prompt === "function"
                  ? globalThis.prompt("New notebook name", "notebook.isb")
                  : "notebook.isb";
                if (typeof notebookName !== "string" || notebookName.trim().length === 0) {
                  return;
                }

                await createNotebookInFolder(folderPath, notebookName);
              },
            }, {
              id: `create-folder-${folderPath}`,
              label: "New folder here",
              onSelect: async () => {
                const folderName = typeof globalThis.prompt === "function"
                  ? globalThis.prompt("New folder name", "folder")
                  : "folder";
                if (typeof folderName !== "string" || folderName.trim().length === 0) {
                  return;
                }

                await createNotebookFolder(folderPath, folderName);
              },
            }],
          });
        }}
        onDragOver={(event) => onDragOver(event, folderPath)}
        onDrop={(event) => onDrop(event, folderPath)}
        className={`${SIDEBAR_ROW_CLASS} ${isDropInside ? "bg-sky-400/[0.12] ring-1 ring-inset ring-sky-300/45" : ""}`}
      >
        <ChevronIcon isExpanded={isExpanded} />
        <img src={getFolderIcon(node.label, isExpanded)} className="w-4 h-4 opacity-80" alt="folder" />
        <span className="truncate text-[12px] font-medium text-[#d6d6db]">{node.label}</span>
      </button>
      {isExpanded && node.children && (
        <TreeNodes
          nodes={node.children}
          depth={depth + 1}
          draggedFileId={draggedFileId}
          dropTargetNodeId={dropTargetNodeId}
          dropTargetPosition={dropTargetPosition}
          onFileDragStart={onFileDragStart}
          onFileDragEnd={onFileDragEnd}
          onFileDragOver={onFileDragOver}
          onFileDrop={onFileDrop}
          onFolderDragOver={onDragOver}
          onFolderDrop={onDrop}
        />
      )}
    </li>
  );
});

const FileItem = memo(({
  node,
  draggedFileId,
  dropTargetNodeId,
  dropTargetPosition,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  node: WorkspaceTreeNode;
  draggedFileId: string | null;
  dropTargetNodeId: string | null;
  dropTargetPosition: NotebookDropPosition | null;
  onDragStart: (event: DragEvent<HTMLButtonElement>, fileId: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>, fileId: string) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>, fileId: string) => void;
}) => {
  const fileId = node.fileId ?? "";
  const isActive = useInterfaceStore((state) => state.selectedApplicationInstanceId === null && state.selectedFileId === fileId);
  const isDirty = useInterfaceStore((state) => Boolean(state.notebookDirtyByFile[fileId]));
  const cellCount = useInterfaceStore((state) => state.isbFiles.find(f => f.relativePath === fileId)?.cellCount);
  const switchRemoteFile = useInterfaceStore((state) => state.switchRemoteFile);
  const openContextMenu = useInterfaceStore((state) => state.openContextMenu);
  const renameNotebook = useInterfaceStore((state) => state.renameNotebook);
  const moveNotebook = useInterfaceStore((state) => state.moveNotebook);
  const deleteNotebook = useInterfaceStore((state) => state.deleteNotebook);
  const isDragging = draggedFileId === fileId;
  const showDropBefore = dropTargetNodeId === node.id && dropTargetPosition === "before";
  const showDropAfter = dropTargetNodeId === node.id && dropTargetPosition === "after";

  return (
    <li className="group relative">
      {showDropBefore ? (
        <div className="pointer-events-none absolute left-1.5 right-1 -top-px flex items-center gap-1">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300 shadow-[0_0_0_3px_rgba(125,211,252,0.14)]" />
          <span className="h-px grow bg-sky-300/90" />
        </div>
      ) : null}
      <button
        type="button"
        draggable
        onDragStart={(event) => onDragStart(event, fileId)}
        onDragEnd={onDragEnd}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        aria-label={`Drag ${node.label}`}
        title="Drag to reorder"
        className={`absolute left-1.5 top-1/2 z-10 flex h-5 w-4 -translate-y-1/2 items-center justify-center rounded-[7px] text-[#666670] transition-all cursor-grab active:cursor-grabbing ${
          isDragging
            ? "bg-sky-300/12 text-sky-200"
            : "opacity-0 translate-x-0.5 group-hover:translate-x-0 group-hover:bg-white/[0.05] group-hover:text-[#9c9ca7] group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:bg-white/[0.05] group-focus-within:text-[#9c9ca7] group-focus-within:opacity-100"
        }`}
      >
        <DragHandleIcon />
      </button>
      <button
        type="button"
        onClick={() => { void switchRemoteFile(fileId); }}
        onDragOver={(event) => onDragOver(event, fileId)}
        onDrop={(event) => onDrop(event, fileId)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openContextMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
              {
                id: `open-notebook-${fileId}`,
                label: "Open",
                tone: isActive ? "accent" : "default",
                onSelect: async () => {
                  await switchRemoteFile(fileId);
                },
              },
              {
                id: `rename-notebook-${fileId}`,
                label: "Rename...",
                onSelect: async () => {
                  const nextName = typeof globalThis.prompt === "function"
                    ? globalThis.prompt("Rename notebook", node.label)
                    : node.label;
                  if (typeof nextName !== "string" || nextName.trim().length === 0) {
                    return;
                  }

                  await renameNotebook(fileId, nextName);
                },
              },
              {
                id: `move-notebook-${fileId}`,
                label: "Move...",
                onSelect: async () => {
                  const targetPath = typeof globalThis.prompt === "function"
                    ? globalThis.prompt("Move notebook to path", fileId)
                    : fileId;
                  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
                    return;
                  }

                  await moveNotebook(fileId, targetPath.trim());
                },
              },
              {
                id: `delete-notebook-${fileId}`,
                label: "Delete",
                tone: "danger",
                onSelect: async () => {
                  await deleteNotebook(fileId);
                },
              },
            ],
          });
        }}
        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1.25 pl-6 text-left transition ${
          isActive
            ? "bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
            : "text-[#a0a0a8] hover:bg-white/[0.05] hover:text-[#d8d8de]"
        } ${isDragging ? "bg-sky-400/[0.08] text-white opacity-60 shadow-[0_8px_24px_rgba(0,0,0,0.28),inset_0_0_0_1px_rgba(125,211,252,0.12)]" : ""}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <img src={getFileIcon(node.label)} className={`w-4 h-4 transition ${isDragging ? "opacity-100" : "opacity-80 group-hover:opacity-95"}`} alt="file" />
          <span className="min-w-0 truncate text-[12px]">{node.label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isDirty ? <span className="text-[10px] text-[#d7ab67]">●</span> : null}
          {cellCount !== undefined ? <span className="text-[11px] text-[#616168]">{cellCount}</span> : null}
        </div>
      </button>
      {showDropAfter ? (
        <div className="pointer-events-none absolute left-1.5 right-1 -bottom-px flex items-center gap-1">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300 shadow-[0_0_0_3px_rgba(125,211,252,0.14)]" />
          <span className="h-px grow bg-sky-300/90" />
        </div>
      ) : null}
    </li>
  );
});

const ApplicationItem = memo(({ instance }: { instance: ApplicationInstance }) => {
  const isActive = useInterfaceStore((state) => state.selectedApplicationInstanceId === instance.instanceId);
  const selectApplicationInstance = useInterfaceStore((state) => state.selectApplicationInstance);
  const closeApplicationInstance = useInterfaceStore((state) => state.closeApplicationInstance);

  return (
    <li className="relative">
      <div className={`mt-0.5 flex items-center gap-2 rounded-md px-1.5 py-1.25 transition ${
        isActive ? "bg-white/[0.08] text-white" : "text-[#a0a0a8] hover:bg-white/[0.05]"
      }`}>
        <button
          type="button"
          onClick={() => selectApplicationInstance(instance.instanceId)}
          className="flex min-w-0 grow cursor-pointer items-center gap-2 text-left"
        >
          <span className="w-3 shrink-0" />
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] bg-white/[0.05] text-[10px] text-[#c5c5cd]">
            A
          </span>
          <span className="min-w-0 truncate text-[12px]">{instance.title}</span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            closeApplicationInstance(instance.instanceId);
          }}
          className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-[#787882] transition hover:bg-white/[0.08] hover:text-white"
          aria-label={`Close ${instance.title}`}
        >
          ×
        </button>
      </div>
    </li>
  );
});

type PinnedApplicationLauncher = {
  id: string;
  label: string;
  badge: string;
  disabled?: boolean;
  status?: string | null;
  onClick: () => void;
};

const TreeNodes = memo(function TreeNodes({
  nodes,
  depth = 0,
  draggedFileId,
  dropTargetNodeId,
  dropTargetPosition,
  onFileDragStart,
  onFileDragEnd,
  onFileDragOver,
  onFileDrop,
  onFolderDragOver,
  onFolderDrop,
}: { nodes: readonly WorkspaceTreeNode[]; depth?: number } & TreeNodeDragProps): ReactNode {
  return (
    <ul className={depth > 0 ? SIDEBAR_NESTED_LIST_CLASS : "space-y-px"}>
      {nodes.map((node) => (
        node.kind === "folder" 
          ? <FolderItem key={node.id} node={node} depth={depth} isDropInside={dropTargetNodeId === node.id && dropTargetPosition === "inside"} draggedFileId={draggedFileId} dropTargetNodeId={dropTargetNodeId} dropTargetPosition={dropTargetPosition} onFileDragStart={onFileDragStart} onFileDragEnd={onFileDragEnd} onFileDragOver={onFileDragOver} onFileDrop={onFileDrop} onDragOver={onFolderDragOver} onDrop={onFolderDrop} /> 
          : <FileItem key={node.id} node={node} draggedFileId={draggedFileId} dropTargetNodeId={dropTargetNodeId} dropTargetPosition={dropTargetPosition} onDragStart={onFileDragStart} onDragEnd={onFileDragEnd} onDragOver={onFileDragOver} onDrop={onFileDrop} />
      ))}
    </ul>
  );
});

type SidebarProps = {
  onCollapse?: () => void;
};

export default memo(function Sidebar({ onCollapse }: SidebarProps) {
  const isbFiles = useInterfaceStore(useShallow((state) => state.isbFiles));
  const isbFolders = useInterfaceStore(useShallow((state) => state.isbFolders));
  const isLoadingFiles = useInterfaceStore((state) => state.isLoadingFiles);
  const notebookOrderState = useInterfaceStore(useShallow((state) => state.notebookOrderState));
  const setNotebookOrderState = useInterfaceStore((state) => state.setNotebookOrderState);
  const applicationInstances = useInterfaceStore(useShallow((state) => state.applicationInstances));
  const applicationSectionExpanded = useInterfaceStore((state) => state.applicationSectionExpanded);
  const toggleApplicationSection = useInterfaceStore((state) => state.toggleApplicationSection);
  const openContextMenu = useInterfaceStore((state) => state.openContextMenu);
  const moveNotebook = useInterfaceStore((state) => state.moveNotebook);
  const createNotebookFolder = useInterfaceStore((state) => state.createNotebookFolder);
  const openApplicationInstance = useInterfaceStore((state) => state.openApplicationInstance);
  const selectedFileId = useInterfaceStore((state) => state.selectedFileId);
  const selectedSessionCode = useInterfaceStore((state) => {
    const currentSelectedFileId = state.selectedFileId;
    return currentSelectedFileId ? (state.sessionCodeByFile[currentSelectedFileId] ?? "") : "";
  });
  const [dragState, setDragState] = useState<NotebookDragState | null>(null);
  const tree = useMemo(() => buildWorkspaceTree(isbFiles, isbFolders, notebookOrderState), [isbFiles, isbFolders, notebookOrderState]);
  const orderedPathsByDirectory = useMemo(() => {
    const groupedPaths = new Map<string, string[]>();
    for (const file of isbFiles) {
      const directoryPath = getNotebookDirectory(file.relativePath);
      const currentPaths = groupedPaths.get(directoryPath) ?? [];
      currentPaths.push(file.relativePath);
      groupedPaths.set(directoryPath, currentPaths);
    }

    for (const [directoryPath, paths] of groupedPaths) {
      groupedPaths.set(directoryPath, sortNotebookPaths(paths, directoryPath, notebookOrderState));
    }

    return groupedPaths;
  }, [isbFiles, notebookOrderState]);
  const pinnedApplications = useMemo<PinnedApplicationLauncher[]>(() => [
    {
      id: INSPECTOR_VM_APPLICATION_ID,
      label: "Inspector VM",
      badge: "IV",
      disabled: !selectedFileId,
      status: !selectedFileId ? "no file" : selectedSessionCode ? "live" : "idle",
      onClick: () => {
        openApplicationInstance({
          applicationId: INSPECTOR_VM_APPLICATION_ID,
          title: createInspectorVmInstanceTitle(selectedFileId),
          input: {
            sessionCode: selectedSessionCode || null,
            relativePath: selectedFileId || null,
          },
        });
      },
    },
    {
      id: CLOAK_BROWSERS_APPLICATION_ID,
      label: "Cloak Browsers",
      badge: "CB",
      onClick: () => {
        openApplicationInstance({
          applicationId: CLOAK_BROWSERS_APPLICATION_ID,
          title: createCloakBrowsersInstanceTitle(),
          input: {},
        });
      },
    },
    {
      id: AI_AGENT_APPLICATION_ID,
      label: "AI Agent",
      badge: "AI",
      onClick: () => {
        openApplicationInstance({ applicationId: AI_AGENT_APPLICATION_ID, title: "AI Agent · new chat", input: {} });
      },
    },
    {
      id: PORT_SCAN_APPLICATION_ID,
      label: "Port Scan",
      badge: "PS",
      onClick: () => {
        openApplicationInstance({ applicationId: PORT_SCAN_APPLICATION_ID, title: "Port Scan · compact console", input: {} });
      },
    },
    {
      id: POSTMAN_APPLICATION_ID,
      label: "Postman",
      badge: "PM",
      onClick: () => {
        openApplicationInstance({ applicationId: POSTMAN_APPLICATION_ID, title: "Postman · new request", input: {} });
      },
    },
    {
      id: ZOOMEYE_APPLICATION_ID,
      label: "ZoomEye",
      badge: "ZE",
      onClick: () => {
        openApplicationInstance({ applicationId: ZOOMEYE_APPLICATION_ID, title: "ZoomEye · live search", input: {} });
      },
    },
    {
      id: CRAWL_AUDIT_APPLICATION_ID,
      label: "Crawl Audit",
      badge: "CA",
      onClick: () => {
        openApplicationInstance({ applicationId: CRAWL_AUDIT_APPLICATION_ID, title: "Crawl Auditor · resource map", input: {} });
      },
    },
  ], [openApplicationInstance, selectedFileId, selectedSessionCode]);

  useEffect(() => {
    const nextOrderState = sanitizeNotebookOrderState(notebookOrderState, isbFiles);
    if (!areNotebookOrderStatesEqual(notebookOrderState, nextOrderState)) {
      setNotebookOrderState(nextOrderState);
    }
  }, [isbFiles, notebookOrderState, setNotebookOrderState]);

  function commitNotebookOrderUpdate(
    draggedFileId: string,
    nextDraggedFileId: string,
    sourceDirectoryPath: string,
    targetDirectoryPath: string,
    options: { targetFileId?: string; position?: "before" | "after" } = {},
  ): void {
    const nextOrderState = { ...notebookOrderState };
    const sourcePaths = [...(orderedPathsByDirectory.get(sourceDirectoryPath) ?? [])].filter((path) => path !== draggedFileId);
    if (sourcePaths.length > 0) {
      nextOrderState[sourceDirectoryPath] = sourcePaths;
    } else {
      delete nextOrderState[sourceDirectoryPath];
    }

    const targetBasePaths = sourceDirectoryPath === targetDirectoryPath
      ? sourcePaths
      : [...(orderedPathsByDirectory.get(targetDirectoryPath) ?? [])].filter((path) => path !== draggedFileId && path !== nextDraggedFileId);
    const nextTargetPaths = [...targetBasePaths];
    const targetIndex = options.targetFileId ? nextTargetPaths.indexOf(options.targetFileId) : -1;
    const insertIndex = targetIndex >= 0
      ? targetIndex + (options.position === "after" ? 1 : 0)
      : nextTargetPaths.length;
    nextTargetPaths.splice(insertIndex, 0, nextDraggedFileId);
    nextOrderState[targetDirectoryPath] = nextTargetPaths;
    setNotebookOrderState(nextOrderState);
  }

  function handleFileDragStart(event: DragEvent<HTMLButtonElement>, fileId: string): void {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", fileId);
    setDragState({ draggedFileId: fileId, targetNodeId: null, position: null });
  }

  function handleFileDragEnd(): void {
    setDragState(null);
  }

  function handleFileDragOver(event: DragEvent<HTMLButtonElement>, fileId: string): void {
    const draggedFileId = dragState?.draggedFileId;
    if (!draggedFileId || draggedFileId === fileId) {
      return;
    }

    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before";
    setDragState({ draggedFileId, targetNodeId: `file:${fileId}`, position });
  }

  async function handleFileDrop(event: DragEvent<HTMLButtonElement>, targetFileId: string): Promise<void> {
    event.preventDefault();
    const draggedFileId = dragState?.draggedFileId ?? event.dataTransfer.getData("text/plain");
    if (!draggedFileId || draggedFileId === targetFileId) {
      setDragState(null);
      return;
    }

    const position = dragState?.position === "after" ? "after" : "before";
    const sourceDirectoryPath = getNotebookDirectory(draggedFileId);
    const targetDirectoryPath = getNotebookDirectory(targetFileId);
    const nextDraggedFileId = sourceDirectoryPath === targetDirectoryPath
      ? draggedFileId
      : joinDraggedNotebookPath(targetDirectoryPath, draggedFileId);

    try {
      if (nextDraggedFileId !== draggedFileId) {
        await moveNotebook(draggedFileId, nextDraggedFileId);
      }
      commitNotebookOrderUpdate(draggedFileId, nextDraggedFileId, sourceDirectoryPath, targetDirectoryPath, {
        targetFileId,
        position,
      });
    } finally {
      setDragState(null);
    }
  }

  function handleFolderDragOver(event: DragEvent<HTMLButtonElement>, folderPath: string): void {
    const draggedFileId = dragState?.draggedFileId;
    if (!draggedFileId || getNotebookDirectory(draggedFileId) === folderPath) {
      return;
    }

    event.preventDefault();
    setDragState({ draggedFileId, targetNodeId: `folder:${folderPath}`, position: "inside" });
  }

  async function handleFolderDrop(event: DragEvent<HTMLButtonElement>, folderPath: string): Promise<void> {
    event.preventDefault();
    const draggedFileId = dragState?.draggedFileId ?? event.dataTransfer.getData("text/plain");
    if (!draggedFileId) {
      setDragState(null);
      return;
    }

    const sourceDirectoryPath = getNotebookDirectory(draggedFileId);
    const nextDraggedFileId = joinDraggedNotebookPath(folderPath, draggedFileId);

    try {
      if (sourceDirectoryPath !== folderPath) {
        await moveNotebook(draggedFileId, nextDraggedFileId);
      }
      commitNotebookOrderUpdate(draggedFileId, sourceDirectoryPath === folderPath ? draggedFileId : nextDraggedFileId, sourceDirectoryPath, folderPath);
    } finally {
      setDragState(null);
    }
  }

  return (
    <aside className="dense-scroll bg-[#0d0d0d] px-1.5 py-3 z-10 flex flex-col h-full">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <ProjectLogo />
        {onCollapse ? <PanelCollapseButton onClick={onCollapse} /> : null}
      </div>
      <div className="overflow-y-auto dense-scroll grow">
        <div className="mb-2.5">
          <button
            type="button"
            onClick={toggleApplicationSection}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openContextMenu({
                x: event.clientX,
                y: event.clientY,
                items: pinnedApplications.map((launcher) => ({
                  id: `launch-${launcher.id}`,
                  label: launcher.status ? `${launcher.label} (${launcher.status})` : launcher.label,
                  disabled: launcher.disabled,
                  tone: launcher.disabled ? "default" : "accent",
                  onSelect: launcher.onClick,
                })),
              });
            }}
            className={SIDEBAR_ROW_CLASS}
          >
            <ChevronIcon isExpanded={applicationSectionExpanded} />
            <img src={getFolderIcon("Applications", applicationSectionExpanded)} className="w-4 h-4 opacity-80" alt="applications" />
            <span className="truncate text-[12px] font-medium text-[#d6d6db]">Applications</span>
            <span className="ml-auto text-[11px] text-[#616168]">{applicationInstances.length}</span>
          </button>

          {applicationSectionExpanded ? (
            applicationInstances.length > 0 ? (
              <ul className={SIDEBAR_NESTED_LIST_CLASS}>
                {applicationInstances.map((instance) => (
                  <ApplicationItem key={instance.instanceId} instance={instance} />
                ))}
              </ul>
            ) : (
              <div className="px-5 py-1.5 text-[11px] text-[#68686e]">
                No open applications.
              </div>
            )
          ) : null}
        </div>

        {tree.length > 0 ? (
          <TreeNodes
            nodes={tree}
            draggedFileId={dragState?.draggedFileId ?? null}
            dropTargetNodeId={dragState?.targetNodeId ?? null}
            dropTargetPosition={dragState?.position ?? null}
            onFileDragStart={handleFileDragStart}
            onFileDragEnd={handleFileDragEnd}
            onFileDragOver={handleFileDragOver}
            onFileDrop={(event, fileId) => { void handleFileDrop(event, fileId); }}
            onFolderDragOver={handleFolderDragOver}
            onFolderDrop={(event, folderPath) => { void handleFolderDrop(event, folderPath); }}
          />
        ) : (
          <div className="px-2 py-3 text-[11px] text-[#68686e] space-y-2">
            <div>{isLoadingFiles ? "Loading .isb files..." : "No .isb files found yet."}</div>
            {!isLoadingFiles ? (
              <button
                type="button"
                onClick={() => {
                  const folderName = typeof globalThis.prompt === "function"
                    ? globalThis.prompt("New folder name", "folder")
                    : "folder";
                  if (typeof folderName !== "string" || folderName.trim().length === 0) {
                    return;
                  }

                  void createNotebookFolder("workspace", folderName);
                }}
                className="rounded-full bg-white/[0.06] px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-white transition hover:bg-white/[0.1]"
              >
                Create Folder
              </button>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
});
