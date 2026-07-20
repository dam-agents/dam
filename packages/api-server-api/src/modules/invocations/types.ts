import type { z } from "zod";
import type {
  invocationViewSchema,
  spawnInvocationRequestSchema,
  spawnInvocationResponseSchema,
} from "./schemas.js";

/** POST /invocations request body the driver sends. */
export type SpawnInvocationRequest = z.infer<
  typeof spawnInvocationRequestSchema
>;
/** POST /invocations reply — the id the driver polls. */
export type SpawnInvocationResponse = z.infer<
  typeof spawnInvocationResponseSchema
>;
/** GET /invocations/:id reply. */
export type InvocationView = z.infer<typeof invocationViewSchema>;
/** The lifecycle status an Invocation reports back. */
export type InvocationStatus = InvocationView["status"];
