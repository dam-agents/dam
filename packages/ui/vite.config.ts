import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Stubs out the server-side tRPC init that `api-server-api`'s index.ts pulls
// in at module load (via a router re-export). tRPC v11 blocks
// `initTRPC.create()` from running outside a Node server, which breaks the
// UI in the browser. The UI only uses the tRPC *client* — the router values
// get constructed but never invoked in the browser — so a no-op `t` is safe
// regardless of mode.
function stubApiServerApiTrpc(): Plugin {
  return {
    name: "ui:stub-api-server-api-trpc",
    enforce: "pre",
    load(id) {
      if (/\/api-server-api\/src\/trpc\.(ts|js)$/.test(id)) {
        return `
          const noop = new Proxy(() => noop, { get: () => noop });
          export const t = { router: (r) => r, procedure: noop, middleware: noop, mergeRouters: (...r) => r[0] ?? {} };
        `;
      }
      return null;
    },
  };
}

export default defineConfig(() => {
  return {
  plugins: [
    stubApiServerApiTrpc(),
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
