import { AcpTurnAbandonedError } from "../../../core/acp-client.js";
import type { NoDefaultModelError } from "../../harness-config/index.js";
import { isNoDefaultModelError } from "../../harness-config/index.js";
import {
  isAgentStoppedError,
  isAgentWakeTimeoutError,
  wakeFailureReasonToken,
} from "../../agents/index.js";
import { wakeFailureUserCopy } from "./wake-failure-copy.js";

export interface TurnFailure {
  reason: string;
  copy: (ctx: { uiBaseUrl: string; agentId: string }) => string;
}

export function classifyTurnFailure(err: unknown): TurnFailure {
  if (isAgentWakeTimeoutError(err))
    return {
      reason: wakeFailureReasonToken(err.failure),
      copy: () => wakeFailureUserCopy(err.failure),
    };
  if (err instanceof AcpTurnAbandonedError)
    return {
      reason: turnFailureReasonToken(err),
      copy: () => turnFailureUserCopy(err),
    };
  if (isAgentStoppedError(err))
    return {
      reason: "agent-stopped",
      copy: () =>
        err.disabled
          ? "This agent is disabled by its owner — ask them to enable it."
          : "This agent was put to sleep by its owner — try again in a moment, or ask its owner to wake it.",
    };
  if (isNoDefaultModelError(err))
    return {
      reason: "no-default-model",
      copy: ({ uiBaseUrl, agentId }) =>
        noDefaultModelUserCopy(err, uiBaseUrl, agentId),
    };
  return {
    reason: "acp-error",
    copy: () => "Something went wrong while relaying this message — try again.",
  };
}

function turnFailureUserCopy(err: AcpTurnAbandonedError): string {
  switch (err.abandonCause) {
    case "connection-lost":
      return (
        "I lost contact with the agent while it was working. It may still " +
        "finish — if its answer doesn't appear here, mention it again: its " +
        "progress is saved and it will pick up where it left off."
      );
    case "stalled":
      return (
        "The agent went quiet partway through and didn't finish. Mention it " +
        "again to have it pick up where it left off — its progress is saved."
      );
  }
}

function turnFailureReasonToken(err: AcpTurnAbandonedError): string {
  switch (err.abandonCause) {
    case "connection-lost":
      return "relay-lost";
    case "stalled":
      return "turn-stalled";
  }
}

function noDefaultModelUserCopy(
  err: NoDefaultModelError,
  uiBaseUrl: string,
  agentId: string,
): string {
  return err.pending
    ? "This agent is still setting up its default model after an update. Try again in a minute."
    : `This agent has no default model, so it can't answer here yet. Its owner can set one at ${uiBaseUrl}/sandboxes/${agentId}/providers`;
}
