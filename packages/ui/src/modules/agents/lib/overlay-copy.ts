import { isStartRefusal } from "api-server-api";

import type { AgentView } from "../../../types.js";
import type { AgentDisplayState } from "../utils/agent-resolver.js";
import { workspaceFailureSentence } from "./workspace-failure.js";

export const VM_MEMORY_FULL =
  "Your VM agents' memory is full. It starts once room frees up — or delete an agent you no longer use.";
const OVERLAY_DESCRIPTION: Record<AgentDisplayState, string> = {
  running: "",
  starting: "",
  preparing_workspace: "Setting up the workspace. This finishes shortly.",
  hibernating: "",
  hibernated: "The agent isn't running.",
  error: "The agent hit an error and isn't running.",
  over_budget:
    "Starting this agent would exceed your compute budget. Delete an agent " +
    "you no longer use to free room, then start this one again.",
};

export function overlayDescription(
  state: AgentDisplayState,
  agent: AgentView,
): string {
  if (state === "error" && agent.error) return agent.error;
  if (state === "error" && agent.startFailure) {
    const why = agent.startFailure.message;
    return `The agent's last start never finished: ${why}${why.endsWith(".") ? "" : "."} Start it to try again.`;
  }
  if (state === "error" && isStartRefusal(agent.podTerminationCode))
    return "This agent can't start right now.";
  const budget = agent.overBudgetMessage;
  if (state === "over_budget" && budget)
    return `${budget[0].toUpperCase()}${budget.slice(1)}${budget.endsWith(".") ? "" : "."}`;
  if (state === "over_budget") return VM_MEMORY_FULL;
  if (state === "preparing_workspace") {
    const failing = agent.workspaceFailures.find((f) => !f.settled);
    if (failing) return workspaceFailureSentence(failing);
  }
  return OVERLAY_DESCRIPTION[state];
}
