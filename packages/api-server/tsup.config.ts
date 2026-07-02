import { defineConfig } from "tsup";

export default defineConfig({
  // Second entry: the `--dry-run` secrets→connections migration admin tool,
  // emitted as dist/migrations/secrets-to-connections.js (#1273).
  // Third entry: the OTel bootstrap preloaded via `node --import` ahead of
  // index.js; a separate bundle by design — index.ts must never import it.
  entry: ["src/index.ts", "src/migrations/secrets-to-connections.ts", "src/telemetry.ts"],
  format: "esm",
  target: "node24",
  platform: "node",
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
