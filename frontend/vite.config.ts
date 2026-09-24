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
    host: "0.0.0.0",
    port: 3011,
    proxy: {
      "/api": { target: "http://127.0.0.1:3018", changeOrigin: true, timeout: 0, proxyTimeout: 0 },
      "/health": { target: "http://127.0.0.1:3018", changeOrigin: true },
      "/m": { target: "http://127.0.0.1:3013", changeOrigin: true, ws: true },
    },
  },
});
