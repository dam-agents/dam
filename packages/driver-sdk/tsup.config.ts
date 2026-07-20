import { defineConfig } from "tsup";

export default defineConfig({
  // Single entry -> dist/driver-sdk.mjs, copied to /usr/local/lib in the
  // platform-base image and imported by the dam-invoke skill.
  entry: { "driver-sdk": "src/index.ts" },
  format: "esm",
  target: "node24",
  platform: "node",
  // Force a `.mjs` extension so node runs it as ESM wherever it lands, and the
  // /usr/local/lib name matches the model-gateway.mjs convention.
  outExtension: () => ({ js: ".mjs" }),
  // api-server-api is a type-only import, erased by esbuild — the shipped file
  // stays dependency-free and single-file. Nothing to bundle at runtime.
  splitting: false,
  clean: true,
});
