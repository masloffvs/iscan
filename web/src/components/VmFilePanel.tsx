import { type ReactNode, useMemo, memo } from "react";
import { useInterfaceStore } from "../store/ui";
import type { RemoteFsEntry } from "../api/client";
import { getFileIcon } from "../file-icons";
import BrowserPanel from "./BrowserPanel";
import PackagesPanel from "./PackagesPanel";

function getFolderIcon(isOpen: boolean) {
  return isOpen ? '/icons/_folder_open.svg' : '/icons/_folder.svg';
}

interface FsTreeNode {
  id: string;
  label: string;
  kind: "file" | "directory";
  path: string;
  children?: FsTreeNode[];
}

function buildFsTree(entries: readonly RemoteFsEntry[]): FsTreeNode[] {
  const rootNodes: FsTreeNode[] = [];
  for (const entry of entries) {
    const segments = entry.path.split("/").filter(Boolean);
    let currentNodes = rootNodes;
    let currentPath = "";
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index] ?? "";
      currentPath = currentPath.length > 0 ? `${currentPath}/${segment}` : `/${segment}`;
      const isLast = index === segments.length - 1;
      const nodeId = `vmfs:${currentPath}`;
      let existingNode = currentNodes.find((node) => node.id === nodeId);
      if (!existingNode) {
        existingNode = {
          id: nodeId,
          label: segment,
          kind: isLast ? entry.kind : "directory",
          path: currentPath,
          children: isLast && entry.kind === "file" ? undefined : [],
        };
        currentNodes.push(existingNode);
        currentNodes.sort((left, right) => {
          if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
          return left.label.localeCompare(right.label);
        });
      }
      if (existingNode.children) {
        currentNodes = existingNode.children;
      }
    }
  }
  return rootNodes;
}

const FolderItem = memo(({ node }: { node: FsTreeNode }) => {
  const isExpanded = useInterfaceStore((state) => state.expandedFolderIds.includes(node.id));
  const toggleFolder = useInterfaceStore((state) => state.toggleFolder);
  const refreshFsDirectory = useInterfaceStore((state) => state.refreshFsDirectory);

  const handleClick = () => {
    toggleFolder(node.id);
    if (!isExpanded) {
      void refreshFsDirectory(node.path);
    }
  };

  return (
    <li className="relative">
      <button
        type="button"
        onClick={handleClick}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-white/[0.05]"
      >
        <span className="w-3 text-[10px] text-[#71717a]">{isExpanded ? "▼" : "▶"}</span>
        <img src={getFolderIcon(isExpanded)} className="w-4 h-4 opacity-80" alt="folder" />
        <span className="truncate text-[13px] font-medium text-[#d6d6db]">{node.label}</span>
      </button>
      {isExpanded && node.children && (
        <div className="ml-2 pl-3 border-l border-white/[0.05] mt-0.5">
          <TreeNodes nodes={node.children} />
        </div>
      )}
    </li>
  );
});

const FileItem = memo(({ node }: { node: FsTreeNode }) => {
  const isActive = useInterfaceStore((state) => state.selectedFsPath === node.path);
  const openFsFile = useInterfaceStore((state) => state.openFsFile);
  const setModal = useInterfaceStore((state) => state.setModal);

  const handleClick = async () => {
    await openFsFile(node.path);
    setModal("file-editor");
  };

  return (
    <li className="relative">
      <button
        type="button"
        onClick={handleClick}
        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition ${
          isActive ? "bg-white/[0.08] text-white" : "text-[#a0a0a8] hover:bg-white/[0.05]"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 w-3" />
          <img src={getFileIcon(node.label)} className="w-4 h-4 opacity-80" alt="file" />
          <span className="min-w-0 truncate text-[13px]">{node.label}</span>
        </div>
      </button>
    </li>
  );
});

const TreeNodes = memo(function TreeNodes({ nodes }: { nodes: readonly FsTreeNode[] }): ReactNode {
  return (
    <ul className="space-y-px">
      {nodes.map((node) => (
        node.kind === "directory"
          ? <FolderItem key={node.id} node={node} />
          : <FileItem key={node.id} node={node} />
      ))}
    </ul>
  );
});

export default function VmFilePanel() {
  const selectedFileId = useInterfaceStore((state) => state.selectedFileId);
  const sessionCodeByFile = useInterfaceStore((state) => state.sessionCodeByFile);
  const fsEntries = useInterfaceStore((state) => state.fsEntries);
  const isFsLoading = useInterfaceStore((state) => state.isFsLoading);
  const refreshFsDirectory = useInterfaceStore((state) => state.refreshFsDirectory);
  const createFsFile = useInterfaceStore((state) => state.createFsFile);
  const rightPanelTab = useInterfaceStore((state) => state.rightPanelTab);
  const selectRightPanelTab = useInterfaceStore((state) => state.selectRightPanelTab);

  const hasSession = Boolean(selectedFileId && sessionCodeByFile[selectedFileId]);
  const tree = useMemo(() => buildFsTree(fsEntries), [fsEntries]);
  const isFilesTab = rightPanelTab === "files";
  const isBrowsersTab = rightPanelTab === "browsers";
  const isPackagesTab = rightPanelTab === "packages";

  return (
    <aside className="bg-[#0d0d0d] flex flex-col min-h-0 h-full p-2">
      <div className="mb-4 px-2 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => { void selectRightPanelTab("files"); }}
              className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition ${isFilesTab ? "bg-white/[0.08] text-white" : "text-[#a0a0a8] hover:text-white"}`}
            >
              Virtual Files
            </button>
            <button
              type="button"
              onClick={() => { void selectRightPanelTab("browsers"); }}
              className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition ${isBrowsersTab ? "bg-white/[0.08] text-white" : "text-[#a0a0a8] hover:text-white"}`}
            >
              Browsers
            </button>
            <button
              type="button"
              onClick={() => { void selectRightPanelTab("packages"); }}
              className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition ${isPackagesTab ? "bg-white/[0.08] text-white" : "text-[#a0a0a8] hover:text-white"}`}
            >
              Packages
            </button>
          </div>
          {isFilesTab ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Refresh"
                onClick={() => { void refreshFsDirectory(); }}
                disabled={!hasSession || isFsLoading}
                className="p-1 rounded-md cursor-pointer text-[#a0a0a8] hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
              </button>
              <button
                type="button"
                title="New File"
                onClick={() => {
                  const name = window.prompt("File name");
                  if (name) void createFsFile(name);
                }}
                disabled={!hasSession}
                className="p-1 rounded-md cursor-pointer text-[#a0a0a8] hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {isFilesTab ? (
        <div className="grow overflow-y-auto dense-scroll px-1">
          {!hasSession ? (
            <div className="px-2 py-3 text-[11px] text-[#68686e]">Open a notebook to view VM files.</div>
          ) : tree.length > 0 ? (
            <TreeNodes nodes={tree} />
          ) : (
            <div className="px-2 py-3 text-[11px] text-[#68686e]">
              {isFsLoading ? "Loading..." : "Empty directory."}
            </div>
          )}
        </div>
      ) : isBrowsersTab ? (
        <BrowserPanel />
      ) : (
        <PackagesPanel />
      )}
    </aside>
  );
}
