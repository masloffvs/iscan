import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: webRoot,
  plugins: [react(), tailwindcss()],
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