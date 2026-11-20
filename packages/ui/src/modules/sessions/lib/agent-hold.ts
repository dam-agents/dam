import {
  connectionCloseCode,
  connectionCloseReason,
} from "../../acp/close-race.js";
import type { AgentDisplayState } from "../../agents/utils/agent-resolver.js";

const HOLD_CLOSE = /^agent (?:not ready|unavailable)(?:: ([a-z-]+))?$/;

export type AgentHoldFailure = { cause: string };

export interface AgentHoldFailureCopy {
  cause: string;
  ownInstruction: boolean;
}

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
    "Starting it would go over your compute budget. Open an agent you aren't using and disable it on its page, then retry.",
  "hibernated-not-scaled":
    "The agent went to sleep before it could open the conversation.",
  "agent-start-failed": "The agent's machine failed to start.",
  "agent-not-ready": "The agent's machine did not come up in time.",
  "gateway-not-ready": "The agent's network gateway did not come up in time.",
  "gateway-pod-failed": "The agent's network gateway failed to start.",
  "reconcile-error": "The platform could not bring the agent up.",
};

const OWN_INSTRUCTION = new Set(["over-budget"]);

// UNIT_BOUNDARY_DESCRIPTION: the sentence that names why a hold ended without the agent. A cause that tells the reader what to do carries its own instruction, so the card gives no generic one beside it: for a budget, retrying the same open only fails again until room is freed.
export function agentHoldFailureCopy(
  failure: AgentHoldFailure,
): AgentHoldFailureCopy {
  return {
    cause:
      HOLD_COPY[failure.cause] ?? "The agent did not become ready in time.",
    ownInstruction: OWN_INSTRUCTION.has(failure.cause),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the chat says while a session open waits.
 * The wait is for the agent whenever it is not running, so it names that wait
 * instead of the conversation's. Waking a sleeping agent and one still
 * starting are one wait to the reader, and a message sent to it reads
 * "Waking the agent" too, so all of them say the same; "Reconnecting to
 * <agent>…" stays for a running agent whose connection dropped.
 */
export function sessionOpenWaitLabel(
  state: AgentDisplayState | undefined,
): string {
  switch (state) {
    case "hibernated":
    case "hibernating":
    case "starting":
    case "preparing_workspace":
      return "Waking the agent…";
    default:
      return "Loading session…";
  }
}
