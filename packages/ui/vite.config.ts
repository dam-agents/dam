import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// === Mock mode — pairs with packages/ui/src/mocks/. Safe to delete this
// plugin + its usage below + the mocks/ folder to remove mock mode entirely. ===
function mockApiServerApiTrpc(): Plugin {
  return {
    name: "ui-mocks:stub-api-server-api-trpc",
    enforce: "pre",
    load(id) {
      if (/\/api-server-api\/src\/trpc\.(ts|js)$/.test(id)) {
        // Stubs out the tRPC server init that the api-server-api package
        // evaluates at module load (via a router re-export in index.ts).
        // tRPC v11 blocks `initTRPC.create()` outside server environments,
        // which breaks the UI dev build. In mock mode we never call these
        // routers — we only need their values to exist without throwing.
        return `
          const noop = new Proxy(() => noop, { get: () => noop });
          export const t = { router: (r) => r, procedure: noop, middleware: noop, mergeRouters: (...r) => r[0] ?? {} };
        `;
      }
      return null;
    },
  };
}
// === End mock mode ===

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const useMocks = env.VITE_USE_MOCKS === "true";
  return {
  plugins: [
    ...(useMocks ? [mockApiServerApiTrpc()] : []),
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // No bundled icon assets — the api-server serves icon.svg + rasterized
      // PNGs at /api/brand/icon* from a Helm-overridable SVG (`brand.icon`).
      // No bundled manifest — same endpoint serves it dynamically.
      manifest: false,
      workbox: {
        // Only cache the app shell — API and WebSocket are online-only
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "google-fonts-cache", expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "gstatic-fonts-cache", expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4444", ws: true, changeOrigin: true },
    },
  },
  };
});
