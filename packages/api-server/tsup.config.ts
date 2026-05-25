import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node24",
  platform: "node",
  splitting: false,
  clean: true,
  noExternal: ["api-server-api", "db", "drizzle-orm", "postgres"],
});
