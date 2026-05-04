import { type ReactNode, useMemo, memo } from "react";
import { useInterfaceStore } from "../store/ui";
import type { RemoteIsbFileEntry } from "../api/client";
import { type WorkspaceTreeNode, getDefaultNotebook } from "../data";
import { getFileIcon } from "../file-icons";

function getFolderIcon(label: string, isOpen: boolean) {
  return isOpen ? '/icons/_folder_open.svg' : '/icons/_folder.svg';
}

function getFolderPath(node: WorkspaceTreeNode): string {
  return node.id.startsWith("folder:") ? node.id.slice("folder:".length) : "";
}

function buildWorkspaceTree(files: readonly RemoteIsbFileEntry[]): WorkspaceTreeNode[] {
  const rootNodes: WorkspaceTreeNode[] = [];
  for (const file of files) {
    const segments = file.relativePath.split("/").filter(Boolean);
    let currentNodes = rootNodes;
    let currentPath = "";
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index] ?? "";
      currentPath = currentPath.length > 0 ? `${currentPath}/${segment}` : segment;
      const isFile = index === segments.length - 1;
      const nodeId = isFile ? `file:${file.relativePath}` : `folder:${currentPath}`;
      let existingNode = currentNodes.find((node) => node.id === nodeId);
      if (!existingNode) {
        existingNode = {
          id: nodeId,
          label: segment,
          kind: isFile ? "file" : "folder",
          fileId: isFile ? file.relativePath : undefined,
          children: isFile ? undefined : [],
        };
        currentNodes.push(existingNode);
        currentNodes.sort((left, right) => {
          if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
          return left.label.localeCompare(right.label);
        });
      }
      if (!isFile) {
        currentNodes = existingNode.children ?? [];
        existingNode.children = currentNodes;
      }
    }
  }
  return rootNodes;
}

const FolderItem = memo(({ node, depth }: { node: WorkspaceTreeNode; depth: number }) => {
  const isExpanded = useInterfaceStore((state) => state.expandedFolderIds.includes(node.id));
  const toggleFolder = useInterfaceStore((state) => state.toggleFolder);
  const openContextMenu = useInterfaceStore((state) => state.openContextMenu);
  const createNotebookInFolder = useInterfaceStore((state) => state.createNotebookInFolder);
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
            }],
          });
        }}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-white/[0.05]"
      >
        <span className="w-3 text-[10px] text-[#71717a]">{isExpanded ? "▼" : "▶"}</span>
        <img src={getFolderIcon(node.label, isExpanded)} className="w-4 h-4 opacity-80" alt="folder" />
        <span className="truncate text-[13px] font-medium text-[#d6d6db]">{node.label}</span>
      </button>
      {isExpanded && node.children && (
        <TreeNodes nodes={node.children} depth={depth + 1} />
      )}
    </li>
  );
});

const FileItem = memo(({ node }: { node: WorkspaceTreeNode }) => {
  const fileId = node.fileId ?? "";
  const isActive = useInterfaceStore((state) => state.selectedFileId === fileId);
  const isDirty = useInterfaceStore((state) => Boolean(state.notebookDirtyByFile[fileId]));
  const cellCount = useInterfaceStore((state) => state.isbFiles.find(f => f.relativePath === fileId)?.cellCount);
  const switchRemoteFile = useInterfaceStore((state) => state.switchRemoteFile);
  const openContextMenu = useInterfaceStore((state) => state.openContextMenu);
  const renameNotebook = useInterfaceStore((state) => state.renameNotebook);
  const moveNotebook = useInterfaceStore((state) => state.moveNotebook);
  const deleteNotebook = useInterfaceStore((state) => state.deleteNotebook);

  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => { void switchRemoteFile(fileId); }}
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
        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition ${
          isActive ? "bg-white/[0.08] text-white" : "text-[#a0a0a8] hover:bg-white/[0.05]"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 w-3" />
          <img src={getFileIcon(node.label)} className="w-4 h-4 opacity-80" alt="file" />
          <span className="min-w-0 truncate text-[13px]">{node.label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isDirty ? <span className="text-[10px] text-[#d7ab67]">●</span> : null}
          {cellCount !== undefined ? <span className="text-[11px] text-[#616168]">{cellCount}</span> : null}
        </div>
      </button>
    </li>
  );
});

const TreeNodes = memo(function TreeNodes({ nodes, depth = 0 }: { nodes: readonly WorkspaceTreeNode[]; depth?: number }): ReactNode {
  return (
    <ul className={depth > 0 ? "relative pl-3 ml-2" : "space-y-px"}>
      {nodes.map((node) => (
        node.kind === "folder" 
          ? <FolderItem key={node.id} node={node} depth={depth} /> 
          : <FileItem key={node.id} node={node} />
      ))}
    </ul>
  );
});

export default function Sidebar() {
  const isbFiles = useInterfaceStore((state) => state.isbFiles);
  const isLoadingFiles = useInterfaceStore((state) => state.isLoadingFiles);
  const tree = useMemo(() => buildWorkspaceTree(isbFiles), [isbFiles]);

  return (
    <aside className="dense-scroll bg-[#0d0d0d] px-2 py-4 z-10 flex flex-col h-full">
      <div className="overflow-y-auto dense-scroll grow">
        {tree.length > 0 ? (
          <TreeNodes nodes={tree} />
        ) : (
          <div className="px-2 py-3 text-[11px] text-[#68686e]">
            {isLoadingFiles ? "Loading .isb files..." : "No .isb files found yet."}
          </div>
        )}
      </div>
    </aside>
  );
}
