import type { z } from "zod";
import type {
  invocationsRunningInputSchema,
  invocationsTreeInputSchema,
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
export type InvocationsTreeInput = z.infer<typeof invocationsTreeInputSchema>;
export type InvocationsRunningInput = z.infer<
  typeof invocationsRunningInputSchema
>;

export interface InvocationTarget {
  driverAgentId: string;
  targetAgentId: string;
}

export interface DelegationNode {
  id: string;
  label: string | null;
  driverAgentId: string;
  status: InvocationStatus;
  errorReason: string | null;
  result?: unknown;
  prompt: string;
  templateId: string | null;
  image: string | null;
  connections: string[];
  cpu: string | null;
  memory: string | null;
  createdAt: string;
  completedAt: string | null;
  transcriptAvailable: boolean;
  children: DelegationNode[];
}

export interface InvocationsQueryService {
  listTargets(): Promise<InvocationTarget[]>;
  tree(input: InvocationsTreeInput): Promise<{ nodes: DelegationNode[] }>;
  running(input: InvocationsRunningInput): Promise<{ nodes: DelegationNode[] }>;
}
