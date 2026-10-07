import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/telemetry.ts"],
  format: "esm",
  target: "node26",
  platform: "node",
  outDir: "dist/js",
  splitting: false,
  clean: true,
  noExternal: [
    "agent-runtime-api",
    "api-server-api",
    "db",
    "drizzle-orm",
    "postgres",
  ],
});
