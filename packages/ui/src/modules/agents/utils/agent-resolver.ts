import type { AgentState, AgentView } from "../../../types.js";

export type AgentDisplayState = AgentState | "over_budget";

export interface AgentDisplay {
  state: AgentDisplayState;
  clickable: boolean;
  powerAction: "restart" | "start" | null;
  slowStart: boolean;
}

const NO_IDS: ReadonlySet<string> = new Set();

export function resolveAgentDisplay(
  agent: AgentView,
  restartingAgentIds: ReadonlySet<string>,
  fallingAsleepAgentIds: ReadonlySet<string> = NO_IDS,
  slowStartIds: ReadonlySet<string> = NO_IDS,
): AgentDisplay {
  const restarting = restartingAgentIds.has(agent.id);
  const fallingAsleep =
    !restarting &&
    agent.state === "running" &&
    fallingAsleepAgentIds.has(agent.id);
  const state: AgentDisplayState = restarting
    ? "starting"
    : fallingAsleep
      ? "hibernating"
      : agent.overBudget
        ? "over_budget"
        : agent.state;
  const clickable =
    !restarting &&
    !fallingAsleep &&
    (agent.state === "running" || agent.state === "hibernated");
  const slowStart =
    !restarting &&
    agent.state === "starting" &&
    !agent.overBudget &&
    (slowStartIds.has(agent.id) || !!agent.podTerminationReason);
  const powerAction: AgentDisplay["powerAction"] =
    restarting || fallingAsleep
      ? null
      : agent.state === "hibernated" || agent.overBudget
        ? "start"
        : agent.state === "running" || agent.state === "error" || slowStart
          ? "restart"
          : null;
  return { state, clickable, powerAction, slowStart };
}
