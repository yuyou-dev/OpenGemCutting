import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { APP_VERSION } from "./src/version.js";
import { labsModulePlugin } from './scripts/labs-vite-plugin.mjs';

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  preview: {
    host: "127.0.0.1",
  },
  plugins: [react(), labsModulePlugin(), { name: "release-version", transformIndexHtml: html => html.replaceAll("%APP_VERSION%", APP_VERSION) }],
});
