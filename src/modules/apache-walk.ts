import { createTableEntity, createTreeEntity, createTreeNode, type OutputEntity, type OutputTone, type PrimitiveTreeNode } from "../primitives";
import type { Result } from "./adapters";
import type { WalkedDirectory } from "./walkers/apache-files-walker";

export type WalkedHostResult = {
	url: string;
	directories: WalkedDirectory[];
};

type MutableTreeNode = {
	label: string;
	value?: string;
	tone?: OutputTone;
	children: MutableTreeNode[];
	childMap: Map<string, MutableTreeNode>;
};

function createMutableTreeNode(label: string, options: Pick<MutableTreeNode, "value" | "tone"> = {}): MutableTreeNode {
	return {
		label,
		value: options.value,
		tone: options.tone,
		children: [],
		childMap: new Map(),
	};
}

function ensureMutableChild(parent: MutableTreeNode, label: string, options: Pick<MutableTreeNode, "value" | "tone"> = {}): MutableTreeNode {
	const existingChild = parent.childMap.get(label);
	if (existingChild) {
		if (existingChild.value === undefined && options.value !== undefined) {
			existingChild.value = options.value;
		}

		if (existingChild.tone === undefined && options.tone !== undefined) {
			existingChild.tone = options.tone;
		}

		return existingChild;
	}

	const child = createMutableTreeNode(label, options);
	parent.children.push(child);
	parent.childMap.set(label, child);
	return child;
}

function toPrimitiveTreeNode(node: MutableTreeNode): PrimitiveTreeNode {
	return createTreeNode(node.label, {
		value: node.value,
		tone: node.tone,
		children: node.children.map(toPrimitiveTreeNode),
	});
}

function ensureDirectoryPath(pathname: string): string {
	return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

function getDirectorySegments(baseUrl: string, directoryUrl: string): string[] {
	const base = new URL(baseUrl);
	const target = new URL(directoryUrl);
	if (base.origin !== target.origin) {
		return [directoryUrl];
	}

	const basePath = ensureDirectoryPath(base.pathname);
	const targetPath = ensureDirectoryPath(target.pathname);
	if (basePath === targetPath) {
		return [];
	}

	if (!targetPath.startsWith(basePath)) {
		return [directoryUrl];
	}

	return targetPath
		.slice(basePath.length)
		.split("/")
		.filter(Boolean)
		.map(segment => `${segment}/`);
}

function buildDirectoryEntryValue(file: WalkedDirectory["files"][number]): string | undefined {
	const detail = [
		file.isDirectory ? "dir" : "file",
		file.size,
		file.lastModified?.toISOString(),
	].filter(Boolean).join(" | ");

	return detail.length > 0 ? detail : undefined;
}

function buildDirectoryFileLabel(file: WalkedDirectory["files"][number]): string {
	const detail = buildDirectoryEntryValue(file) ?? "";

	return detail.length > 0 ? `${file.path} (${detail})` : file.path;
}

function buildHostTree(hostResults: readonly WalkedHostResult[]): PrimitiveTreeNode[] {
	return hostResults.map(hostResult => {
		const fileCount = hostResult.directories.reduce((total, directory) => total + directory.files.length, 0);
		const rootNode = createMutableTreeNode(hostResult.url, {
			value: `${hostResult.directories.length} dir(s) | ${fileCount} file(s)`,
		});

		for (const directory of hostResult.directories) {
			let currentNode = rootNode;
			for (const segment of getDirectorySegments(hostResult.url, directory.url)) {
				currentNode = ensureMutableChild(currentNode, segment, { tone: "info" });
			}

			if (currentNode !== rootNode) {
				currentNode.tone = directory.error ? "error" : "info";
				currentNode.value = directory.error ? directory.error : `${directory.files.length} item(s)`;
			}

			for (const file of directory.files) {
				if (file.isDirectory) {
					const childNode = ensureMutableChild(currentNode, file.path, {
						value: buildDirectoryEntryValue(file),
						tone: "info",
					});

					if (childNode.tone !== "error") {
						childNode.tone = "info";
					}
					continue;
				}

				ensureMutableChild(currentNode, buildDirectoryFileLabel(file));
			}
		}

		return toPrimitiveTreeNode(rootNode);
	});
}

function createApacheWalkSummaryTable(hostResults: readonly WalkedHostResult[]) {
	return createTableEntity(
		[
			{ key: "url", header: "Url", maxWidth: 34 },
			{ key: "directories", header: "Dirs", align: "right", maxWidth: 8 },
			{ key: "files", header: "Files", align: "right", maxWidth: 8 },
			{ key: "errors", header: "Errors", align: "right", maxWidth: 8 },
			{ key: "status", header: "Status", maxWidth: 12 },
		],
		hostResults.map(hostResult => {
			const fileCount = hostResult.directories.reduce((total, directory) => total + directory.files.length, 0);
			const errorCount = hostResult.directories.filter(directory => Boolean(directory.error)).length;

			return {
				url: hostResult.url,
				directories: hostResult.directories.length,
				files: fileCount,
				errors: errorCount,
				status: errorCount > 0 ? "partial" : "ok",
			};
		}),
		{ title: "Apache index results" },
	);
}

export function normalizeWalkedDirectories(url: string, walkResult: Result<WalkedDirectory[]>): WalkedDirectory[] {
	if (walkResult.isSuccess) {
		return walkResult.unwrap();
	}

	return [{ url, files: [], error: String(walkResult.getError()) }];
}

export function createApacheWalkOutput(hostResults: readonly WalkedHostResult[]): OutputEntity[] {
	return [
		createApacheWalkSummaryTable(hostResults),
		createTreeEntity(buildHostTree(hostResults), {
			title: "Apache index tree",
		}),
	];
}