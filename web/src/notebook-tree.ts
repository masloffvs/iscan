import type { WorkspaceTreeNode } from "./data";

export type NotebookOrderState = Record<string, string[]>;

export const NOTEBOOK_ORDER_STORAGE_KEY = "iscan:notebook-order";

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function getFolderPathFromNodeId(nodeId: string): string {
  return nodeId.startsWith("folder:") ? nodeId.slice("folder:".length) : "";
}

export function getNotebookDirectory(relativePath: string): string {
  const segments = relativePath.split("/").filter(Boolean);
  return segments.slice(0, -1).join("/");
}

export function getNotebookLabel(relativePath: string): string {
  return relativePath.split("/").filter(Boolean).at(-1) ?? relativePath;
}

export function getNotebookGroupLabel(directory: string): string {
  if (directory.length === 0) {
    return "workspace";
  }

  return directory.split("/").filter(Boolean).at(-1) ?? directory;
}

export function readPersistedNotebookOrderState(): NotebookOrderState {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(NOTEBOOK_ORDER_STORAGE_KEY);
    if (!rawValue) {
      return {};
    }

    const parsedValue = JSON.parse(rawValue) as unknown;
    if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsedValue)
        .filter((entry): entry is [string, unknown] => typeof entry[0] === "string")
        .map(([directoryPath, value]) => [
          directoryPath,
          Array.isArray(value)
            ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))]
            : [],
        ])
        .filter(([, value]) => value.length > 0),
    );
  } catch {
    return {};
  }
}

export function sortNotebookPaths(
  paths: readonly string[],
  directoryPath: string,
  orderState: NotebookOrderState,
): string[] {
  const orderIndexByPath = new Map((orderState[directoryPath] ?? []).map((path, index) => [path, index]));

  return [...paths].sort((left, right) => {
    const leftOrder = orderIndexByPath.get(left);
    const rightOrder = orderIndexByPath.get(right);
    if (leftOrder !== undefined || rightOrder !== undefined) {
      if (leftOrder === undefined) {
        return 1;
      }
      if (rightOrder === undefined) {
        return -1;
      }

      return leftOrder - rightOrder;
    }

    return compareText(getNotebookLabel(left), getNotebookLabel(right));
  });
}

function compareNotebookPaths(
  leftPath: string,
  rightPath: string,
  directoryPath: string,
  orderState: NotebookOrderState,
): number {
  const orderIndexByPath = new Map((orderState[directoryPath] ?? []).map((path, index) => [path, index]));
  const leftOrder = orderIndexByPath.get(leftPath);
  const rightOrder = orderIndexByPath.get(rightPath);
  if (leftOrder !== undefined || rightOrder !== undefined) {
    if (leftOrder === undefined) {
      return 1;
    }
    if (rightOrder === undefined) {
      return -1;
    }

    return leftOrder - rightOrder;
  }

  return compareText(getNotebookLabel(leftPath), getNotebookLabel(rightPath));
}

export function sanitizeNotebookOrderState(
  orderState: NotebookOrderState,
  files: readonly { relativePath: string }[],
): NotebookOrderState {
  const pathsByDirectory = new Map<string, string[]>();

  for (const file of files) {
    const directoryPath = getNotebookDirectory(file.relativePath);
    const currentPaths = pathsByDirectory.get(directoryPath) ?? [];
    currentPaths.push(file.relativePath);
    pathsByDirectory.set(directoryPath, currentPaths);
  }

  const nextState: NotebookOrderState = {};
  for (const [directoryPath, paths] of pathsByDirectory) {
    const pathSet = new Set(paths);
    const preservedPaths = [...new Set((orderState[directoryPath] ?? []).filter((path) => pathSet.has(path)))];
    const preservedPathSet = new Set(preservedPaths);
    const unorderedPaths = paths
      .filter((path) => !preservedPathSet.has(path))
      .sort((left, right) => compareText(getNotebookLabel(left), getNotebookLabel(right)));
    nextState[directoryPath] = [...preservedPaths, ...unorderedPaths];
  }

  return nextState;
}

function ensureFolderNode(rootNodes: WorkspaceTreeNode[], folderPath: string): WorkspaceTreeNode | null {
  const segments = folderPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  let currentNodes = rootNodes;
  let currentPath = "";
  let currentNode: WorkspaceTreeNode | null = null;

  for (const segment of segments) {
    currentPath = currentPath.length > 0 ? `${currentPath}/${segment}` : segment;
    const nodeId = `folder:${currentPath}`;
    let nextNode = currentNodes.find((node) => node.id === nodeId);
    if (!nextNode) {
      nextNode = {
        id: nodeId,
        label: segment,
        kind: "folder",
        children: [],
      };
      currentNodes.push(nextNode);
    }

    currentNode = nextNode;
    currentNodes = nextNode.children ?? [];
    nextNode.children = currentNodes;
  }

  return currentNode;
}

function sortWorkspaceTreeNodes(
  nodes: readonly WorkspaceTreeNode[],
  parentDirectoryPath: string,
  orderState: NotebookOrderState,
): WorkspaceTreeNode[] {
  const folders = nodes
    .filter((node) => node.kind === "folder")
    .map((node) => ({
      ...node,
      children: node.children
        ? sortWorkspaceTreeNodes(node.children, getFolderPathFromNodeId(node.id), orderState)
        : undefined,
    }))
    .sort((left, right) => compareText(left.label, right.label));

  const files = nodes
    .filter((node): node is WorkspaceTreeNode & { fileId: string } => node.kind === "file" && typeof node.fileId === "string")
    .sort((left, right) => compareNotebookPaths(left.fileId, right.fileId, parentDirectoryPath, orderState));

  return [...folders, ...files];
}

export function buildWorkspaceTree(
  files: readonly { relativePath: string }[],
  folders: readonly { relativePath: string }[],
  orderState: NotebookOrderState,
): WorkspaceTreeNode[] {
  const rootNodes: WorkspaceTreeNode[] = [];
  const folderPaths = [...new Set(folders.map((entry) => entry.relativePath).filter(Boolean))]
    .sort((left, right) => {
      const depthDelta = left.split("/").length - right.split("/").length;
      return depthDelta !== 0 ? depthDelta : compareText(left, right);
    });

  for (const folderPath of folderPaths) {
    ensureFolderNode(rootNodes, folderPath);
  }

  for (const file of files) {
    const directoryPath = getNotebookDirectory(file.relativePath);
    const parentNode = directoryPath.length > 0 ? ensureFolderNode(rootNodes, directoryPath) : null;
    const targetNodes = parentNode?.children ?? rootNodes;
    const nodeId = `file:${file.relativePath}`;
    if (targetNodes.some((node) => node.id === nodeId)) {
      continue;
    }

    targetNodes.push({
      id: nodeId,
      label: getNotebookLabel(file.relativePath),
      kind: "file",
      fileId: file.relativePath,
    });
  }

  return sortWorkspaceTreeNodes(rootNodes, "", orderState);
}