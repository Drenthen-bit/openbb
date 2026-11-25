/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.TERMINAL_BACKEND ?? "http://127.0.0.1:6901";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../backend/odp_terminal/static",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: {
      "/terminal/ws": { target: backend.replace("http", "ws"), ws: true },
      "/terminal": backend,
      "/odp": backend,
    },
  },
  test: { environment: "node" },
});
