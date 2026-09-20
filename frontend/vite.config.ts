import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3011,
    proxy: {
      "/api": { target: "http://127.0.0.1:3018", changeOrigin: true, timeout: 0, proxyTimeout: 0 },
      "/health": { target: "http://127.0.0.1:3018", changeOrigin: true },
    },
  },
});
