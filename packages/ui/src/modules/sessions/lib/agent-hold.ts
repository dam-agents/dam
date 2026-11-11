import {
  connectionCloseCode,
  connectionCloseReason,
} from "../../acp/close-race.js";
import type { AgentDisplayState } from "../../agents/utils/agent-resolver.js";

const HOLD_CLOSE = /^agent (?:not ready|unavailable)(?:: ([a-z-]+))?$/;

export type AgentHoldFailure = { cause: string };

/**
 * UNIT_BOUNDARY_DESCRIPTION: the api-server holds a chat's socket while the
 * agent wakes or comes back, and closes it with 1011 and the hold's cause —
 * `agent not ready: <cause>`, or `agent unavailable` — when the hold ends
 * without the agent. That close is the agent's state, not the conversation's:
 * the conversation is still there once the agent is. An agent that is not
 * found is left to the not-found path, which asks whether the session exists.
 */
export function agentHoldFailure(e: unknown): AgentHoldFailure | null {
  const closeReason = connectionCloseReason(e);
  if (connectionCloseCode(e) !== 1011 || closeReason === null) return null;
  const held = HOLD_CLOSE.exec(closeReason);
  if (!held) return null;
  const cause = held[1] ?? "unknown";
  return cause === "not-found" ? null : { cause };
}

const HOLD_COPY: Record<string, string> = {
  "over-budget":
    "Starting it would go over its compute budget. Stop agents you aren't using, then try again.",
  "hibernated-not-scaled":
    "The agent went to sleep before it could open the conversation.",
  "agent-start-failed": "The agent's machine failed to start.",
  "agent-not-ready": "The agent's machine did not come up in time.",
  "gateway-not-ready": "The agent's network gateway did not come up in time.",
  "gateway-pod-failed": "The agent's network gateway failed to start.",
  "reconcile-error": "The platform could not bring the agent up.",
};

export function agentHoldFailureCopy(failure: AgentHoldFailure): string {
  return HOLD_COPY[failure.cause] ?? "The agent did not become ready in time.";
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the chat says while a session open waits.
 * The wait is for the agent whenever it is not running, so it names that wait
 * instead of the conversation's, and an agent that sleeps is being woken by
 * the open itself.
 */
export function sessionOpenWaitLabel(
  state: AgentDisplayState | undefined,
): string {
  switch (state) {
    case "hibernated":
    case "hibernating":
      return "Waking the agent…";
    case "starting":
    case "preparing_workspace":
      return "Waiting for the agent to start…";
    default:
      return "Loading session…";
  }
}
