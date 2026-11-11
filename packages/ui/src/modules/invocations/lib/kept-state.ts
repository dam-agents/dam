import type { AgentState, KeptSubAgent } from "api-server-api";

export type KeptStateLabel = "asleep" | "running" | "idle" | "starting";

// UNIT_BOUNDARY_DESCRIPTION: what a kept sub-agent is doing, in one word: whether its machine sleeps or runs, and, while it runs, whether a run is going or it waits for one.
export function keptStateLabel(
  subAgent: Pick<KeptSubAgent, "status">,
  agentState: AgentState | undefined,
): KeptStateLabel {
  if (agentState === "hibernated" || agentState === "hibernating")
    return "asleep";
  if (agentState === "starting" || agentState === "preparing_workspace")
    return "starting";
  return subAgent.status === "running" ? "running" : "idle";
}
