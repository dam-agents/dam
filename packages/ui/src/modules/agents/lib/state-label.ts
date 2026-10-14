import type { AgentDisplayState } from "../utils/agent-resolver.js";

const STATE_LABEL: Record<AgentDisplayState, string> = {
  running: "Running",
  starting: "Starting",
  preparing_workspace: "Preparing workspace",
  hibernating: "Pausing",
  hibernated: "Paused",
  error: "Error",
  over_budget: "Over budget",
  migrating: "Migrating",
};

// UNIT_BOUNDARY_DESCRIPTION: the state badge's word. A refused vm agent waits for its owner's memory, which is no budget of theirs, so every caller must say which backend the agent runs on. An agent whose start was refused, by full storage or a boot that never came up, did not fail while running, so it reads "Can't start" rather than "Error".
export function badgeLabel(
  state: AgentDisplayState,
  vm: boolean,
  refused = false,
): string {
  if (state === "error" && refused) return "Can't start";
  return vm && state === "over_budget"
    ? "Waiting for memory"
    : STATE_LABEL[state];
}
