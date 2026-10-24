import type { AgentDisplayState } from "../utils/agent-resolver.js";

const STATE_LABEL: Record<AgentDisplayState, string> = {
  running: "Running",
  starting: "Starting",
  preparing_workspace: "Preparing workspace",
  hibernating: "Falling asleep",
  hibernated: "Sleeping",
  disabled: "Disabled",
  error: "Error",
  over_budget: "Over budget",
};

// UNIT_BOUNDARY_DESCRIPTION: the state badge's word. An agent over budget waits for its owner's memory, which is no budget of theirs. An agent whose start was refused, by full storage or a boot that never came up, did not fail while running, so it reads "Can't start" rather than "Error".
export function badgeLabel(state: AgentDisplayState, refused: boolean): string {
  if (state === "error" && refused) return "Can't start";
  return state === "over_budget" ? "Waiting for memory" : STATE_LABEL[state];
}
