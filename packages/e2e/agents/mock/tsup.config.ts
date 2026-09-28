import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: "esm",
  target: "node26",
  platform: "node",
  noExternal: ["mock-agent-api"],
  outDir: "dist/js",
  splitting: false,
  clean: true,
});
