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

export interface DelegationNode {
  id: string;
  label: string | null;
  driverAgentId: string;
  status: InvocationStatus;
  errorReason: string | null;
  result?: unknown;
  prompt: string;
  script: string | null;
  exitCode: number | null;
  templateId: string | null;
  image: string | null;
  connections: string[];
  requestedModel: string | null;
  createdAt: string;
  completedAt: string | null;
  transcriptAvailable: boolean;
  children: DelegationNode[];
}

export interface InvocationsQueryService {
  listTargets(): Promise<InvocationTarget[]>;
  tree(input: InvocationsTreeInput): Promise<{ nodes: DelegationNode[] }>;
  running(input: InvocationsRunningInput): Promise<{ nodes: DelegationNode[] }>;
  transcript(input: InvocationTranscriptInput): Promise<InvocationTranscript>;
}

export interface InvocationsControlService {
  stop(input: InvocationStopInput): Promise<void>;
}
