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

/** One spawn as a driver → target pair (an Invocation's id IS its target
 *  agent's id). All statuses: a terminal row outlives its agent, so a
 *  reaped-any-second target stays attributed. */
export interface InvocationTarget {
  driverAgentId: string;
  targetAgentId: string;
}

/** Owner-scoped read the agents router joins into its list/get responses.
 *  Deliberately not a public router of its own — the write surface (spawn,
 *  report) lives on the harness REST port and never rides tRPC. */
export interface InvocationsQueryService {
  listTargets(): Promise<InvocationTarget[]>;
}
