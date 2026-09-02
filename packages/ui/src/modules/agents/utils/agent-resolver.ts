import type { AgentState, AgentView } from "../../../types.js";

export type AgentDisplayState =
  | AgentState
  | "over_budget"
  | "running_always_on"
  | "idle_always_on";

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
  const alwaysOn = agent.hibernationTimeoutMin === 0;

  let state: AgentDisplayState;
  if (pausing) {
    state = "hibernating";
  } else if (agent.overBudget) {
    state = "over_budget";
  } else if (restarting || agent.state === "starting" || agent.state === "preparing_workspace") {
    state = alwaysOn ? "running_always_on" : "running";
  } else if (agent.state === "running") {
    state = alwaysOn ? "running_always_on" : "running";
  } else if (agent.state === "hibernated") {
    state = alwaysOn ? "idle_always_on" : "hibernated";
  } else {
    state = agent.state;
  }

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
