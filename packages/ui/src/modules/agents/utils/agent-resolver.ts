import type { AgentState, AgentView } from "../../../types.js";

/** Parked (#1900) is a display-only refinement of `starting`: the sandbox
 *  wants to run but its owner is over budget. Free room, then Start retries
 *  the gate (only never-hibernate sandboxes restart by themselves). */
export type AgentDisplayState = AgentState | "over_budget";

export interface AgentDisplay {
  /** Derived state that drives the status pill. */
  state: AgentDisplayState;
  /** Whether the agent pod is reachable enough to click through. */
  clickable: boolean;
  /** Which power action to offer — mutually exclusive; `null` means the action
   *  is disabled (transient states like `starting`/`hibernating`/`restarting`). */
  powerAction: "restart" | "start" | null;
}

/**
 * Pure projection: derive the display-level state from an agent's runtime
 * status. An optimistic restart (Restart clicked before the poll sees the pod
 * dip) presents as `starting` — a restart and a cold start are the same
 * "coming up" state to the user, so they share one presentation.
 */
const NO_IDS: ReadonlySet<string> = new Set();

export function resolveAgentDisplay(
  agent: AgentView,
  restartingAgentIds: ReadonlySet<string>,
  pausingAgentIds: ReadonlySet<string> = NO_IDS,
): AgentDisplay {
  const restarting = restartingAgentIds.has(agent.id);
  // Optimistic Pause/Stop: present as `hibernating` only while the poll still
  // sees the pod running — once it reports the pod down, the real hibernated
  // state carries the same pill, so the overlay steps aside.
  const pausing =
    !restarting && agent.state === "running" && pausingAgentIds.has(agent.id);
  const state: AgentDisplayState = restarting
    ? "starting"
    : pausing
      ? "hibernating"
      : agent.overBudget
        ? "over_budget"
        : agent.state;
  const clickable =
    !restarting &&
    !pausing &&
    (agent.state === "running" || agent.state === "hibernated");
  const powerAction: AgentDisplay["powerAction"] =
    restarting || pausing
      ? null
      : // A parked sandbox doesn't start by itself — Start is its retry
        // through the budget gate.
        agent.state === "hibernated" || agent.overBudget
        ? "start"
        : agent.state === "running" || agent.state === "error"
          ? "restart"
          : null;
  return { state, clickable, powerAction };
}
