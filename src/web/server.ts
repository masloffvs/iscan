import { extname } from "node:path";

import { logger } from "../logger";
import { DEFAULT_WEB_PORT, resolveWebAssets } from "./build";

const assetExtensions = new Set([".css", ".js", ".ico", ".json", ".map", ".png", ".svg", ".txt", ".webp"]);

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

      if (pathname === "/app.js") {
        return new Response(Bun.file(assets.appPath));
      }

      if (pathname === "/styles.css") {
        return new Response(Bun.file(assets.cssPath));
      }

      if (assetExtensions.has(extname(pathname))) {
        return new Response("Not found", { status: 404 });
      }

      return new Response(Bun.file(assets.indexHtmlPath));
    },
  });

  logger.info({ port: server.port, assetsDir: assets.outDir }, "Web interface started");

  return await new Promise<never>(() => {});
}