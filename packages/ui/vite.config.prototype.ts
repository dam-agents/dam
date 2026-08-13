import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Redirect the mock browser module import to a no-op so the MSW service worker
 * code is excluded from the bundle entirely. The prototype entry point
 * (main-prototype.tsx) seeds data directly and never calls worker.start().
 */
function mswBypass(): Plugin {
  const target = path.resolve(__dirname, "src/mock/browser.ts");
  const replacement = path.resolve(__dirname, "src/mock/browser-noop.ts");
  return {
    name: "msw-bypass",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer) return null;
      if (source === "./mock/browser.js" || source === "./mock/browser.ts") {
        return replacement;
      }
      if (source === target) return replacement;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [mswBypass(), tailwindcss(), react(), viteSingleFile()],
  define: {
    "import.meta.env.VITE_MOCK": JSON.stringify("true"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist-prototype",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "prototype.html"),
    },
  },
});
