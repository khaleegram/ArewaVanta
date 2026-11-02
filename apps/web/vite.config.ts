import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export default defineConfig(({ command }) => {
  const buildId = command === "build" ? `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}` : "development";
  let outputDirectory = "";
  return {
    define: { __APP_BUILD_ID__: JSON.stringify(buildId) },
    plugins: [react(), {
      name: "arewavanta-release",
      apply: "build",
      configResolved(config) { outputDirectory = resolve(config.root, config.build.outDir); },
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "release.json", source: JSON.stringify({ buildId }) });
      },
      async closeBundle() {
        const path = resolve(outputDirectory, "service-worker.js");
        const worker = await readFile(path, "utf8");
        await writeFile(path, worker.replaceAll("__APP_BUILD_ID__", buildId));
      },
    }],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
    },
    preview: { port: 4173, strictPort: true },
  };
});
