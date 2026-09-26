import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "driver-sdk": "src/index.ts" },
  format: "esm",
  target: "node26",
  platform: "node",
  outExtension: () => ({ js: ".mjs" }),
  outDir: "dist/js",
  splitting: false,
  clean: true,
});
