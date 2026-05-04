import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const bundledRuntimeMarkers = [
	["config.yml"],
] as const;

export const sourceProjectRoot = resolve(import.meta.dir, "..");
export const executableRoot = dirname(process.execPath);
export const runtimeRoot = bundledRuntimeMarkers.some(pathSegments => existsSync(resolve(executableRoot, ...pathSegments)))
	? executableRoot
	: sourceProjectRoot;

export function resolveRuntimePath(...pathSegments: string[]): string {
	const runtimePath = resolve(runtimeRoot, ...pathSegments);
	if (existsSync(runtimePath)) {
		return runtimePath;
	}

	return resolve(sourceProjectRoot, ...pathSegments);
}

export function resolveWritableRuntimePath(...pathSegments: string[]): string {
	return resolve(runtimeRoot, ...pathSegments);
}

export function resolveRuntimeFilePath(filePath: string): string {
	if (isAbsolute(filePath)) {
		return filePath;
	}

	return resolveRuntimePath(filePath);
}

export function resolveCwdOrRuntimeFilePath(filePath: string): string {
	if (isAbsolute(filePath)) {
		return filePath;
	}

	const cwdPath = resolve(process.cwd(), filePath);
	if (existsSync(cwdPath)) {
		return cwdPath;
	}

	return resolveRuntimePath(filePath);
}