import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/agent.ts"],
  format: "esm",
  target: "node22",
  platform: "node",
  noExternal: ["agent-runtime-api", "api-server-api"],
  external: ["@lydell/node-pty", "@xterm/headless", "@xterm/addon-serialize"],
  splitting: false,
  clean: true,
});
