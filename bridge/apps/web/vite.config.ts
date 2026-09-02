import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  server: {
    port: 6767,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:6766",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:6766",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
