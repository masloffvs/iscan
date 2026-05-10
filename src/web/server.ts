import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";

import { logger } from "../logger";
import { DEFAULT_WEB_PORT, resolveWebAssets } from "./build";

function resolveStaticAssetPath(rootDir: string, pathname: string): string | null {
  const normalizedPath = pathname.replace(/^\/+/, "");
  if (normalizedPath.length === 0) {
    return null;
  }

  const assetPath = resolve(rootDir, normalizedPath);
  const normalizedRoot = rootDir.endsWith("/") ? rootDir : `${rootDir}/`;
  if (assetPath !== rootDir && !assetPath.startsWith(normalizedRoot)) {
    return null;
  }

  return assetPath;
}

export async function startWebInterface(port = DEFAULT_WEB_PORT): Promise<never> {
  const assets = await resolveWebAssets();

  const server = Bun.serve({
    port,
    fetch(request) {
      const url = new URL(request.url);
      const pathname = url.pathname;

      if (pathname === "/api" || pathname.startsWith("/api/")) {
        const proxyPath = pathname === "/api" ? "/" : pathname.slice(4);
        const proxyUrl = new URL(`http://127.0.0.1:36665${proxyPath}${url.search}`);
        return fetch(proxyUrl, {
          method: request.method,
          headers: request.headers,
          body: request.method === "GET" || request.method === "HEAD"
            ? undefined
            : request.body,
        });
      }

      if (pathname === "/" || pathname === "/index.html") {
        return new Response(Bun.file(assets.indexHtmlPath));
      }

      const assetPath = resolveStaticAssetPath(assets.outDir, pathname);
      if (assetPath && existsSync(assetPath)) {
        return new Response(Bun.file(assetPath));
      }

      if (pathname.startsWith("/assets/") || extname(pathname).length > 0) {
        return new Response("Not found", { status: 404 });
      }

      return new Response(Bun.file(assets.indexHtmlPath));
    },
  });

  logger.info({ port: server.port, assetsDir: assets.outDir }, "Web interface started");

  return await new Promise<never>(() => {});
}