import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    outDir: "dist/js",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4444", ws: true, changeOrigin: true },
    },
  },
});
