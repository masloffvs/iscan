import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = dirname(fileURLToPath(import.meta.url));

function modernMonacoTypescriptShim() {
  const shimPath = resolve(webRoot, "src/modern-monaco/typescript-default-export.ts");

  return {
    name: "modern-monaco-typescript-shim",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (
        source === "typescript"
        && importer?.includes("modern-monaco/dist/lsp/typescript/worker.mjs")
      ) {
        return shimPath;
      }

      return null;
    },
  };
}

export default defineConfig({
  root: webRoot,
  plugins: [modernMonacoTypescriptShim(), react(), tailwindcss()],
  optimizeDeps: {
    include: ["typescript"],
  },
  server: {
    host: "0.0.0.0",
    port: 8086,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:36665",
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/u, ""),
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 8086,
    strictPort: true,
  },
});