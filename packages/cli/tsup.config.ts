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
  // Ship a self-contained dist/bin.js: the contract packages (api-server-api,
  // agent-runtime-api) are private and never published, so everything except
  // Node builtins must fold into the bundle. Bundle-everything is more robust
  // than a hand-maintained list, which silently relied on each dep sitting in
  // devDependencies (tsup externalizes only `dependencies`/`peerDependencies`).
  noExternal: [/.*/],
  // commander is bundled as CJS and calls `require()` at runtime; ESM output
  // has no `require`, so synthesize one. Without this, `node dist/bin.js`
  // throws "Dynamic require of 'events'" on first call. (This also lets ws's
  // optional native-addon requires fail gracefully into its JS fallback.)
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
});
