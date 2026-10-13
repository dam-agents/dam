import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts", "src/server.ts"],
  format: "esm",
  target: "node26",
  platform: "node",
  noExternal: [/^(?!@lydell\/node-pty)/],
  esbuildOptions(options) {
    options.mainFields = ["main", "module"];
  },
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  outDir: "dist/js",
  splitting: false,
  clean: true,
});
