import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: "esm",
  target: "node26",
  platform: "node",
  noExternal: [/.*/],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  outDir: "dist/js",
  splitting: false,
  clean: true,
});
