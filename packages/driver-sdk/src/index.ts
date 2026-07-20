// driver-sdk — a dependency-free wrapper over the platform's Invocation
// primitive (issue #2784, ADR-078 loop-as-driver-program). A "driver" agent
// uses it to spawn ephemeral Invocations, hand each one a prompt, and get back
// a schema-validated result, without hand-rolling the create-then-poll HTTP
// dance. Built with tsup to a single dependency-free `.mjs` baked into the
// platform-base image at /usr/local/lib/driver-sdk.mjs.

export {
  s,
  type JsonSchema,
  type SchemaSpec,
  type SchemaSugar,
} from "./schema.js";
export { driverAgentId } from "./http.js";
export {
  spawn,
  listImages,
  listConnections,
  InvocationFailed,
  type SpawnOptions,
  type ImageInfo,
  type ConnectionInfo,
} from "./spawn.js";
