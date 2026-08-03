import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: "esm",
  target: "node24",
  platform: "node",
  // These contract packages are inlined into dist, which is why they live
  // under devDependencies in package.json — the deployed runtime never
  // requires them at install time. Keep these two facts in sync.
  noExternal: ["agent-runtime-api", "api-server-api"],
  external: ["@lydell/node-pty", "@xterm/headless", "@xterm/addon-serialize"],
  splitting: false,
  clean: true,
});
