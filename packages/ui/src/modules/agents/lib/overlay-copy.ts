import { isStartRefusal } from "api-server-api";

import type { AgentView } from "../../../types.js";
import type { AgentDisplayState } from "../utils/agent-resolver.js";
import { reclaimSentence } from "./reclaim-notices.js";
import { workspaceFailureSentence } from "./workspace-failure.js";

const VM_MEMORY_FULL =
  "Your VM agents' memory is full. It starts once room frees up — or put an agent you aren't using to sleep.";
const OVERLAY_DESCRIPTION: Record<AgentDisplayState, string> = {
  running: "",
  starting: "",
  preparing_workspace: "Setting up the workspace. This finishes shortly.",
  hibernating: "The agent is falling asleep.",
  hibernated: "The agent is sleeping. Wake it to pick up where you left off.",
  error: "The agent hit an error and isn't running.",
  over_budget:
    "Starting this agent would exceed your compute budget. Put agents " +
    "you aren't using to sleep to free room, then start this one again.",
  migrating:
    "The agent is moving to the new sandbox runtime. It is back once its " +
    "data has been copied, which takes a few minutes.",
};

export function overlayDescription(
  state: AgentDisplayState,
  agent: AgentView,
): string {
  if (state === "error" && agent.error) return agent.error;
  if (state === "error" && isStartRefusal(agent.podTerminationCode))
    return "This agent can't start right now.";
  const budget = agent.overBudgetMessage;
  if (state === "over_budget" && budget)
    return `${budget[0].toUpperCase()}${budget.slice(1)}${budget.endsWith(".") ? "" : "."}`;
  if (state === "over_budget" && agent.vm) return VM_MEMORY_FULL;
  const reclaimed = reclaimSentence(agent);
  if (state === "hibernated" && reclaimed) return reclaimed;
  if (state === "preparing_workspace") {
    const failing = agent.workspaceFailures.find((f) => !f.settled);
    if (failing) return workspaceFailureSentence(failing);
  }
  return OVERLAY_DESCRIPTION[state];
}
