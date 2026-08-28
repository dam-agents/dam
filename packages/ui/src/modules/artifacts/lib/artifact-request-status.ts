import type {
  ArtifactRequestFailureReason,
  ArtifactRequestProgress,
  ArtifactRequestState,
} from "api-server-api";
import { artifactRequestFailureReasonSchema } from "api-server-api";

import { getErrorMessage } from "../../../lib/errors.js";
import type { AgentState } from "../../../types.js";

const WAKING_AGENT_STATES: ReadonlySet<AgentState> = new Set<AgentState>([
  "starting",
  "preparing_workspace",
  "hibernating",
  "hibernated",
]);

export function deriveRequestProgress(
  requestState: ArtifactRequestState | undefined,
  agentState: AgentState | undefined,
): ArtifactRequestProgress {
  if (requestState === "delivered") return "running";
  if (requestState === undefined) return "sent";
  if (agentState !== undefined && WAKING_AGENT_STATES.has(agentState))
    return "waking";
  return "queued";
}

export function progressLabel(progress: ArtifactRequestProgress): string {
  switch (progress) {
    case "sent":
      return "Sending your request to the agent…";
    case "waking":
      return "Waking the agent…";
    case "queued":
      return "Waiting for the agent to pick it up…";
    case "running":
      return "The agent is working on it…";
  }
}

export interface ArtifactRequestFailure {
  reason: ArtifactRequestFailureReason;
  message: string;
  nextStep: string | null;
}

export function describeFailure(
  reason: ArtifactRequestFailureReason,
): ArtifactRequestFailure {
  switch (reason) {
    case "agent_deleted":
      return {
        reason,
        message: "The agent that published this page is gone.",
        nextStep: "The page still works, it just cannot ask for anything new.",
      };
    case "session_deleted":
      return {
        reason,
        message: "The conversation this page asks in has been deleted.",
        nextStep:
          "The page still works, it just has nowhere left to ask. Ask the agent for a fresh page.",
      };
    case "wake_failed":
      return {
        reason,
        message: "The agent could not be woken.",
        nextStep: "Try again in a moment.",
      };
    case "over_budget":
      return {
        reason,
        message: "There is no room to run the agent right now.",
        nextStep: "Raise the budget or wait for the current period to roll.",
      };
    case "rate_limited":
      return {
        reason,
        message: "This page has asked its agent 60 times in the last hour.",
        nextStep:
          "It can ask again once the oldest of those falls out of the hour.",
      };
    case "busy":
      return {
        reason,
        message: "This page is already waiting on an answer.",
        nextStep: "Wait for that one to land, then ask again.",
      };
    case "cancelled":
      return { reason, message: "The request was cancelled.", nextStep: null };
    case "expired":
      return {
        reason,
        message: "The agent did not answer in time.",
        nextStep: "Ask again.",
      };
  }
}

export function failureReasonOf(
  error: unknown,
): ArtifactRequestFailureReason | null {
  const data = (error as { data?: unknown })?.data;
  if (!data || typeof data !== "object" || !("artifactRequestRefusal" in data))
    return null;
  const refusal = (data as { artifactRequestRefusal: unknown })
    .artifactRequestRefusal;
  if (!refusal || typeof refusal !== "object" || !("reason" in refusal))
    return null;
  const parsed = artifactRequestFailureReasonSchema.safeParse(
    (refusal as { reason: unknown }).reason,
  );
  return parsed.success ? parsed.data : null;
}

export function failureFromError(error: unknown): ArtifactRequestFailure {
  const named = failureReasonOf(error);
  if (named) return describeFailure(named);
  return {
    reason: "wake_failed",
    message: getErrorMessage(
      error,
      "The request never reached the agent.",
    ).trim(),
    nextStep: "Try again in a moment.",
  };
}
