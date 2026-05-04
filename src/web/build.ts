import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveRuntimePath, resolveWritableRuntimePath, runtimeRoot, sourceProjectRoot } from "../runtime-paths";

export const DEFAULT_WEB_PORT = 8086;

type WebAssetPaths = {
  outDir: string;
  indexHtmlPath: string;
  appPath: string;
  cssPath: string;
};

type BuildWebAssetsOptions = {
  outDir: string;
};

const devEntryHref = "/src/main.tsx";
const devStyleHref = "/src/styles.css";

function getWebAssetPaths(outDir: string): WebAssetPaths {
  return {
    outDir,
    indexHtmlPath: resolve(outDir, "index.html"),
    appPath: resolve(outDir, "app.js"),
    cssPath: resolve(outDir, "styles.css"),
  };
}

function hasWebAssets(paths: WebAssetPaths): boolean {
  return [paths.indexHtmlPath, paths.appPath, paths.cssPath].every((filePath) => existsSync(filePath));
}

function formatBuildErrors(logs: Array<{ message?: string }>): string {
  const messages = logs
    .map((log) => log.message?.trim())
    .filter((message): message is string => Boolean(message && message.length > 0));

  if (messages.length === 0) {
    return "Unknown build error.";
  }

  return messages.join("\n");
}

function renderIndexHtml(template: string, entryHref: string, styleHref: string): string {
  return template
    .replace(devEntryHref, entryHref)
    .replace(devStyleHref, styleHref);
}

export async function buildWebAssets(options: BuildWebAssetsOptions): Promise<WebAssetPaths> {
  const webRoot = resolveRuntimePath("web");
  const entrypointPath = resolve(webRoot, "src/main.tsx");
  const stylesPath = resolve(webRoot, "src/styles.css");
  const indexHtmlPath = resolve(webRoot, "index.html");
  const assetPaths = getWebAssetPaths(options.outDir);

  await rm(options.outDir, { recursive: true, force: true });
  await mkdir(options.outDir, { recursive: true });

  const jsBuild = await Bun.build({
    entrypoints: [entrypointPath],
    target: "browser",
    format: "esm",
    minify: false,
  });

  if (!jsBuild.success) {
    throw new Error(`Failed to build web bundle.\n${formatBuildErrors(jsBuild.logs)}`);
  }

  const appBundle = jsBuild.outputs[0];
  if (!appBundle) {
    throw new Error("Failed to build web bundle. Missing JavaScript output.");
  }

  await Bun.write(assetPaths.appPath, appBundle);

  const cssBuild = Bun.spawnSync({
    cmd: [process.execPath, "x", "@tailwindcss/cli", "-i", stylesPath, "-o", assetPaths.cssPath],
    cwd: webRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (cssBuild.exitCode !== 0) {
    const output = `${cssBuild.stdout.toString()}${cssBuild.stderr.toString()}`.trim();
    throw new Error(output.length > 0 ? output : "Failed to build Tailwind stylesheet.");
  }

  const indexTemplate = await Bun.file(indexHtmlPath).text();
  await Bun.write(assetPaths.indexHtmlPath, renderIndexHtml(indexTemplate, "/app.js", "/styles.css"));

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