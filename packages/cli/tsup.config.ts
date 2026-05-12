import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const HERE = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(HERE, "package.json"), "utf-8"),
) as { version: string };

export default defineConfig({
  entry: ["src/bin.ts"],
  format: "esm",
  target: "node20",
  platform: "node",
  splitting: false,
  clean: true,
  // Ship a self-contained dist/bin.js. Node-builtins stay external; runtime
  // deps fold into the bundle so `node dist/bin.js` works from anywhere.
  noExternal: [
    "@trpc/client",
    "@trpc/server",
    "api-server-api",
    "commander",
    "open",
    "smol-toml",
    "zod",
  ],
  // CJS deps (commander) use dynamic `require()` of node builtins; ESM
  // doesn't expose `require` by default, so synthesize one at the top of
  // the bundle. Without this, `node dist/bin.js` throws on first call.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
});
