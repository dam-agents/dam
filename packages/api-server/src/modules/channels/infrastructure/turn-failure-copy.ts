import {
  agentPageUrl,
  jsonRpcErrorDetails,
  saysProviderUnavailable,
} from "api-server-api";

import {
  AcpModelRefusedError,
  AcpTurnAbandonedError,
} from "../../../core/acp-client.js";
import { ChannelProfileRefusedError } from "./channel-profile.js";
import { PROVIDER_UNAVAILABLE_TURN_REASON } from "../../../events.js";
import type { NoDefaultModelError } from "../../harness-config/index.js";
import { isNoDefaultModelError } from "../../harness-config/index.js";
import {
  isAgentStoppedError,
  isAgentWakeTimeoutError,
  wakeFailureReasonToken,
} from "../../agents/index.js";
import { wakeFailureUserCopy } from "./wake-failure-copy.js";

export type TurnFailure =
  | {
      kind: "plain";
      reason: string;
      copy: (ctx: {
        uiBaseUrl: string;
        agentId: string;
        threads: boolean;
      }) => string;
    }
  | {
      kind: "provider-unavailable";
      reason: typeof PROVIDER_UNAVAILABLE_TURN_REASON;
    };

export function classifyTurnFailure(err: unknown): TurnFailure {
  if (isAgentWakeTimeoutError(err))
    return {
      kind: "plain",
      reason: wakeFailureReasonToken(err.failure),
      copy: () => wakeFailureUserCopy(err.failure),
    };
  if (err instanceof AcpTurnAbandonedError)
    return {
      kind: "plain",
      reason: turnFailureReasonToken(err),
      copy: () => turnFailureUserCopy(err),
    };
  if (err instanceof AcpModelRefusedError)
    return {
      kind: "plain",
      reason: "model-refused",
      copy: ({ uiBaseUrl, agentId, threads }) =>
        modelRefusedUserCopy(agentPageUrl(uiBaseUrl, agentId, "providers"), {
          threads,
        }),
    };
  if (isAgentStoppedError(err))
    return {
      kind: "plain",
      reason: "agent-stopped",
      copy: () =>
        err.disabled
          ? "This agent is disabled by its owner — ask them to enable it."
          : "This agent was put to sleep by its owner — try again in a moment, or ask its owner to wake it.",
    };
  if (isNoDefaultModelError(err))
    return {
      kind: "plain",
      reason: "no-default-model",
      copy: ({ uiBaseUrl, agentId }) =>
        noDefaultModelUserCopy(err, uiBaseUrl, agentId),
    };
  if (err instanceof ChannelProfileRefusedError)
    return {
      kind: "plain",
      reason: "profile-unavailable",
      copy: ({ uiBaseUrl, agentId }) =>
        `This channel runs on the profile “${err.profileName}”, which this agent can't use: ${err.detail}. Its owner can pick another profile on the channel's row at ${agentPageUrl(uiBaseUrl, agentId, "channels")}`,
    };
  if (saysProviderUnavailable(errorText(err)))
    return {
      kind: "provider-unavailable",
      reason: PROVIDER_UNAVAILABLE_TURN_REASON,
    };
  return {
    kind: "plain",
    reason: "acp-error",
    copy: () => "Something went wrong while relaying this message — try again.",
  };
}

function errorText(err: unknown): string {
  if (err === null || typeof err !== "object") return String(err);
  const { message, data } = err as { message?: unknown; data?: unknown };
  return [message, jsonRpcErrorDetails(data)]
    .filter((part) => typeof part === "string")
    .join(" ");
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

function modelRefusedUserCopy(
  providersUrl: string,
  { threads }: { threads: boolean },
): string {
  const refused =
    "The model refused this message, so the agent couldn't answer it.";
  const switchModel = `ask the agent's owner to switch it to another model at ${providersUrl}`;
  return threads
    ? `${refused} Rephrase it in a new thread — this thread keeps the refused message, so asking here again is refused too — or ${switchModel}`
    : `${refused} Try rephrasing it, or ${switchModel}`;
}

function noDefaultModelUserCopy(
  err: NoDefaultModelError,
  uiBaseUrl: string,
  agentId: string,
): string {
  return err.pending
    ? "This agent is still setting up its default model after an update. Try again in a minute."
    : `This agent has no default model, so it can't answer here yet. Its owner can set one at ${agentPageUrl(uiBaseUrl, agentId, "providers")}`;
}
