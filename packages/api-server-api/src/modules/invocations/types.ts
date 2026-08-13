import type { z } from "zod";
import type {
  invocationViewSchema,
  spawnInvocationRequestSchema,
  spawnInvocationResponseSchema,
} from "./schemas.js";

export type SpawnInvocationRequest = z.infer<
  typeof spawnInvocationRequestSchema
>;
export type SpawnInvocationResponse = z.infer<
  typeof spawnInvocationResponseSchema
>;
export type InvocationView = z.infer<typeof invocationViewSchema>;
export type InvocationStatus = InvocationView["status"];

export interface InvocationTarget {
  driverAgentId: string;
  targetAgentId: string;
}

export interface InvocationsQueryService {
  listTargets(): Promise<InvocationTarget[]>;
}
