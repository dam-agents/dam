import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "driver-sdk": "src/index.ts" },
  format: "esm",
  target: "node24",
  platform: "node",
  outExtension: () => ({ js: ".mjs" }),
  splitting: false,
  clean: true,
});
