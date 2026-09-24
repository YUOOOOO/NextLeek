import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/m/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../frontend/src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3013,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:3018", changeOrigin: true, timeout: 0, proxyTimeout: 0 },
      "/health": { target: "http://127.0.0.1:3018", changeOrigin: true },
    },
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
});
