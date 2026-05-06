import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: "esm",
  target: "node20",
  platform: "node",
  splitting: false,
  clean: true,
});
