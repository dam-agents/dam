import type { AgentState, AgentView } from "../../../types.js";

export type AgentDisplayState = AgentState | "restarting";

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
 * status, layering the optimistic "Restarting" pill on top.
 */
export function resolveAgentDisplay(
  agent: AgentView,
  restartingAgentIds: ReadonlySet<string>,
): AgentDisplay {
  const restarting = restartingAgentIds.has(agent.id);
  const state: AgentDisplayState = restarting ? "restarting" : agent.state;
  const clickable =
    !restarting && (agent.state === "running" || agent.state === "hibernated");
  const powerAction: AgentDisplay["powerAction"] = restarting
    ? null
    : agent.state === "hibernated"
      ? "start"
      : agent.state === "running" || agent.state === "error"
        ? "restart"
        : null;
  return { state, clickable, powerAction };
}
