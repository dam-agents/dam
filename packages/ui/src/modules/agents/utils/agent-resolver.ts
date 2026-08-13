import type { AgentState, AgentView } from "../../../types.js";

export type AgentDisplayState = AgentState | "over_budget";

export interface AgentDisplay {
  state: AgentDisplayState;
  clickable: boolean;
  powerAction: "restart" | "start" | null;
}

const NO_IDS: ReadonlySet<string> = new Set();

export function resolveAgentDisplay(
  agent: AgentView,
  restartingAgentIds: ReadonlySet<string>,
  pausingAgentIds: ReadonlySet<string> = NO_IDS,
): AgentDisplay {
  const restarting = restartingAgentIds.has(agent.id);
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
      : agent.state === "hibernated" || agent.overBudget
        ? "start"
        : agent.state === "running" || agent.state === "error"
          ? "restart"
          : null;
  return { state, clickable, powerAction };
}
