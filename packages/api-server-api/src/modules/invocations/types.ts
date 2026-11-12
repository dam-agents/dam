import type { z } from "zod";
import type { OwnerQuestionNotice } from "../attention/types.js";
import type {
  invocationHarnessConfigSchema,
  invocationOutputBlobSchema,
  invocationOutputLinkSchema,
  invocationOutputSchema,
  invocationOutputStreamSchema,
  invocationAnswerInputSchema,
  invocationStopInputSchema,
  invocationsQuestionsInputSchema,
  ownerQuestionInputSchema,
  invocationTranscriptInputSchema,
  invocationsRunningInputSchema,
  invocationsTreeInputSchema,
  invocationViewSchema,
  spawnInvocationRequestSchema,
  spawnInvocationResponseSchema,
  setEgressResponseSchema,
  egressWaitingSchema,
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
export type SetEgressResponse = z.infer<typeof setEgressResponseSchema>;
export type EgressWaiting = z.infer<typeof egressWaitingSchema>;
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
export type InvocationAnswerInput = z.infer<typeof invocationAnswerInputSchema>;
export type InvocationsQuestionsInput = z.infer<
  typeof invocationsQuestionsInputSchema
>;
export type OwnerQuestionInput = z.infer<typeof ownerQuestionInputSchema>;

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

// UNIT_BOUNDARY_DESCRIPTION: the question a sub-agent waits on: what it asks, the options it offers, the one it takes when nobody answers, and the time it waits until.
export interface DelegationQuestion {
  text: string;
  options: string[];
  default: string;
  askedAt: string;
  answerBy: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the answer a sub-agent's work goes on from: what was answered and who answered, the owner, or nobody, so it took its default at the time it waited until.
export interface DelegationAnswer {
  text: string;
  by: "owner" | "default";
  at: string;
  answerBy: string;
}

// UNIT_BOUNDARY_DESCRIPTION: a question a sub-agent under a Driver waits on, for the Driver's chat to put to the owner: the sub-agent's id and what to call it, and the question.
export interface OwnerQuestion extends DelegationQuestion {
  id: string;
  title: string;
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
  // UNIT_BOUNDARY_DESCRIPTION: the sub-agent has not started its work because a network rule its driver set for it waits for the owner's answer; it is not working.
  waitingForOwner?: boolean;
  question?: DelegationQuestion;
  answer?: DelegationAnswer;
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
  questions(
    input: InvocationsQuestionsInput,
  ): Promise<{ questions: OwnerQuestion[] }>;
  // UNIT_BOUNDARY_DESCRIPTION: every question a sub-agent of the owner's waits on, each with the Agent and Session whose chat puts it to them.
  waitingForOwner(): Promise<OwnerQuestionNotice[]>;
}

export interface InvocationsControlService {
  stop(input: InvocationStopInput): Promise<void>;
  answer(input: InvocationAnswerInput): Promise<void>;
}
