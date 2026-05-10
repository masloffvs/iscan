import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveRuntimePath, resolveWritableRuntimePath, runtimeRoot, sourceProjectRoot } from "../runtime-paths";

export const DEFAULT_WEB_PORT = 8086;

type WebAssetPaths = {
  outDir: string;
  indexHtmlPath: string;
};

type BuildWebAssetsOptions = {
  outDir: string;
};

function getWebAssetPaths(outDir: string): WebAssetPaths {
  return {
    outDir,
    indexHtmlPath: resolve(outDir, "index.html"),
  };
}

function hasWebAssets(paths: WebAssetPaths): boolean {
  return existsSync(paths.indexHtmlPath);
}

function formatBuildOutput(output: string): string {
  const trimmed = output.trim();
  return trimmed.length > 0 ? trimmed : "Unknown build error.";
}

export async function buildWebAssets(options: BuildWebAssetsOptions): Promise<WebAssetPaths> {
  const webRoot = resolveRuntimePath("web");
  const viteConfigPath = resolve(webRoot, "vite.config.ts");
  const assetPaths = getWebAssetPaths(options.outDir);

  await rm(options.outDir, { recursive: true, force: true });
  await mkdir(options.outDir, { recursive: true });

  const buildResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      "x",
      "vite",
      "build",
      "--config",
      viteConfigPath,
      "--outDir",
      options.outDir,
      "--emptyOutDir",
    ],
    cwd: webRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (buildResult.exitCode !== 0) {
    const output = `${buildResult.stdout.toString()}${buildResult.stderr.toString()}`;
    throw new Error(`Failed to build web bundle.\n${formatBuildOutput(output)}`);
  }

  return assetPaths;
}

export async function resolveWebAssets(): Promise<WebAssetPaths> {
  const bundledAssetPaths = getWebAssetPaths(resolveRuntimePath("web-build"));
  if (runtimeRoot !== sourceProjectRoot && hasWebAssets(bundledAssetPaths)) {
    return bundledAssetPaths;
  }

  const runtimeAssetPaths = getWebAssetPaths(resolveWritableRuntimePath(".iscan/web"));
  return await buildWebAssets({ outDir: runtimeAssetPaths.outDir });
}