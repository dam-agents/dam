import type { z } from "zod";
import type {
  invocationHarnessConfigSchema,
  invocationOutputBlobSchema,
  invocationOutputLinkSchema,
  invocationOutputSchema,
  invocationOutputStreamSchema,
  invocationStopInputSchema,
  invocationTranscriptInputSchema,
  invocationsRunningInputSchema,
  invocationsTreeInputSchema,
  invocationViewSchema,
  spawnInvocationRequestSchema,
  spawnInvocationResponseSchema,
  stopInvocationRequestSchema,
  stopInvocationResponseSchema,
  spawnScriptInvocationRequestSchema,
} from "./schemas.js";

export type SpawnInvocationRequest = z.input<
  typeof spawnInvocationRequestSchema
>;
export type SpawnScriptInvocationRequest = z.input<
  typeof spawnScriptInvocationRequestSchema
>;
export type InvocationOutputStream = z.infer<
  typeof invocationOutputStreamSchema
>;
export type InvocationOutputBlob = z.infer<typeof invocationOutputBlobSchema>;
export type InvocationOutput = z.infer<typeof invocationOutputSchema>;
export type InvocationOutputLink = z.infer<typeof invocationOutputLinkSchema>;
export type SpawnInvocationResponse = z.infer<
  typeof spawnInvocationResponseSchema
>;
export type InvocationView = z.infer<typeof invocationViewSchema>;
export type StopInvocationRequest = z.infer<typeof stopInvocationRequestSchema>;
export type StopInvocationResponse = z.infer<
  typeof stopInvocationResponseSchema
>;
export type InvocationStatus = InvocationView["status"];
export type InvocationsTreeInput = z.infer<typeof invocationsTreeInputSchema>;
export type InvocationTranscriptInput = z.infer<
  typeof invocationTranscriptInputSchema
>;

export type InvocationStopInput = z.infer<typeof invocationStopInputSchema>;

export interface InvocationTranscript {
  frames: string[];
  truncated: boolean;
}
export type InvocationsRunningInput = z.infer<
  typeof invocationsRunningInputSchema
>;
export type InvocationHarnessConfig = z.infer<
  typeof invocationHarnessConfigSchema
>;

export interface InvocationTarget {
  driverAgentId: string;
  targetAgentId: string;
}

// UNIT_BOUNDARY_DESCRIPTION: a failed run that was stopped rather than failing: by the user, or by its driver, with the driver's reason when it gave one.
export interface DelegationStopped {
  by: "user" | "driver";
  reason: string | null;
}

export interface DelegationNode {
  id: string;
  label: string | null;
  driverAgentId: string;
  status: InvocationStatus;
  errorReason: string | null;
  stopped: DelegationStopped | null;
  result?: unknown;
  prompt: string;
  script: string | null;
  exitCode: number | null;
  templateId: string | null;
  image: string | null;
  connections: string[];
  requestedModel: string | null;
  createdAt: string;
  started: boolean;
  completedAt: string | null;
  transcriptAvailable: boolean;
  children: DelegationNode[];
}

// UNIT_BOUNDARY_DESCRIPTION: a sub-agent spawned with keep, at any depth below the agent asked about, that still exists: what to call it, where its runs stand (running while any of them runs, else as its last run ended), until when it is kept, and the kept sub-agent it sits under (null for the agent asked about itself), the nearest one still listed when the sub-agent between them was removed.
export interface KeptSubAgent {
  id: string;
  label: string | null;
  status: InvocationStatus;
  keepUntil: string;
  parentId: string | null;
}

export interface InvocationsQueryService {
  listTargets(): Promise<InvocationTarget[]>;
  kept(input: {
    driverAgentId: string;
  }): Promise<{ subAgents: KeptSubAgent[] }>;
  tree(input: InvocationsTreeInput): Promise<{ nodes: DelegationNode[] }>;
  running(input: InvocationsRunningInput): Promise<{ nodes: DelegationNode[] }>;
  transcript(input: InvocationTranscriptInput): Promise<InvocationTranscript>;
}

export interface InvocationsControlService {
  stop(input: InvocationStopInput): Promise<void>;
}
