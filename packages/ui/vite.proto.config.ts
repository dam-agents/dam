import { readFileSync } from "node:fs";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const UI = path.resolve(__dirname);
const PKGS = path.resolve(__dirname, "..");

/**
 * The app reads `window.location.pathname`, so a route has to be a real path —
 * a hash leaves every screen on Home. Serves the prototype shell for any path
 * that is not a file request.
 */
const appPaths: Plugin = {
  name: "proto-app-paths",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = (req.url ?? "/").split("?")[0]!;
      if (url.includes(".") || url.startsWith("/@") || url.startsWith("/src")) {
        next();
        return;
      }
      const html = await server.transformIndexHtml(
        url,
        readFileSync(path.resolve(UI, "proto.html"), "utf8"),
      );
      res.setHeader("content-type", "text/html");
      res.end(html);
    });
  },
};

/**
 * Serves the prototype entry point in `src/mock` against fixtures. The monorepo
 * tsconfig extends an uninstalled package and half the Tailwind classes come
 * from files outside this dir, so both are pinned here.
 */
export default defineConfig({
  plugins: [tailwindcss(), react(), appPaths],
  publicDir: path.resolve(UI, "public"),
  esbuild: {
    jsx: "automatic",
    target: "es2022",
    tsconfigRaw: {
      compilerOptions: {
        target: "es2022",
        useDefineForClassFields: true,
        experimentalDecorators: false,
        verbatimModuleSyntax: false,
      },
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: /^\.\/auth\.js$/, replacement: path.resolve(UI, "src/mock/auth.ts") },
      {
        find: /^(\.\.\/)+auth\.js$/,
        replacement: path.resolve(UI, "src/mock/auth.ts"),
      },
      { find: "@", replacement: path.resolve(UI, "src") },
      {
        find: "api-server-api/router",
        replacement: path.resolve(PKGS, "api-server-api/src/router.ts"),
      },
      {
        find: "api-server-api",
        replacement: path.resolve(PKGS, "api-server-api/src/index.ts"),
      },
      {
        find: "agent-runtime-api",
        replacement: path.resolve(PKGS, "agent-runtime-api/src/index.ts"),
      },
    ],
  },
  server: { port: 5410, strictPort: true, fs: { allow: [PKGS] } },
});
