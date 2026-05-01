import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node22",
  platform: "node",
  splitting: false,
  clean: true,
  noExternal: ["api-server-api", "db", "drizzle-orm", "postgres"],
  // Ship the vendored Envoy auth proto next to the bundled JS — the gRPC
  // ext_authz handler reads it at startup. The runtime path resolution in
  // grpc.ts probes for it in `dist/proto` first (prod) and the source-tree
  // location second (dev).
  onSuccess: "mkdir -p dist/proto && cp proto/external_auth.proto dist/proto/",
});
