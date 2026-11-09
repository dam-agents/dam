import {
  agentPageUrl,
  jsonRpcErrorDetails,
  saysProviderUnavailable,
} from "api-server-api";

import {
  AcpModelCallFailedError,
  AcpModelRefusedError,
  AcpTurnAbandonedError,
} from "../../../core/acp-client.js";
import { agentSessionUrl } from "./agent-footer.js";
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
import { spendRefusalIn, type SpendHoldReason } from "../../spend/index.js";

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
      kind: "spend";
      reason: "spend-limit" | "spend-ceiling";
      block: SpendHoldReason;
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
  const spend = spendRefusalIn(errorText(err));
  if (spend !== null)
    return {
      kind: "spend",
      reason: spend === "ceiling" ? "spend-ceiling" : "spend-limit",
      block: spend,
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
  if (err instanceof AcpModelCallFailedError)
    return {
      kind: "plain",
      reason:
        err.failure === "rejected"
          ? "model-call-rejected"
          : "model-call-failed",
      copy: ({ uiBaseUrl, agentId }) =>
        modelCallFailedUserCopy(err, {
          providersUrl: agentPageUrl(uiBaseUrl, agentId, "providers"),
          sessionUrl: agentSessionUrl(uiBaseUrl, agentId, err.sessionId),
        }),
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
  return [
    message,
    jsonRpcErrorDetails(data),
    ...(err instanceof AcpModelCallFailedError ? [errorText(err.cause)] : []),
  ]
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

function modelCallFailedUserCopy(
  err: AcpModelCallFailedError,
  links: { providersUrl: string; sessionUrl: string },
): string {
  const failed =
    err.failure === "rejected"
      ? "The agent's model call was refused, so it couldn't answer this message."
      : "The agent's model call failed, so it couldn't answer this message.";
  const said =
    err.providerText === null
      ? ""
      : ` The error was: “${err.providerText.replace(/</g, "‹").replace(/>/g, "›")}”.`;
  const next =
    err.failure === "rejected"
      ? `Try again in a moment. If it fails again, ask the agent's owner to check its model provider — its key, its quota and its access to the model — at ${links.providersUrl}`
      : `Try again in a moment. If it keeps failing, ask the agent's owner to check its model provider at ${links.providersUrl}`;
  return `${failed}${said} ${next}\nThe session, with the error: ${links.sessionUrl}`;
}

function noDefaultModelUserCopy(
  err: NoDefaultModelError,
  uiBaseUrl: string,
  agentId: string,
): string {
  const providers = agentPageUrl(uiBaseUrl, agentId, "providers");
  if (err.pending)
    return "This agent is still setting up its default model after an update. Try again in a minute.";
  return err.model === undefined
    ? `This agent has no model provider, so it can't answer here yet. Its owner can connect one at ${providers}`
    : `This agent's default model ${err.model} is on a provider it no longer holds, so it can't answer here yet. Its owner can pick another at ${providers}`;
}
