import type { AgentState, KeptSubAgent } from "api-server-api";

export type KeptStateLabel = "running" | "idle" | "starting";

// UNIT_BOUNDARY_DESCRIPTION: what a kept sub-agent is doing, in one word: whether a run is going, it is starting, or it waits for a run, as a machine stopped for idleness does.
export function keptStateLabel(
  subAgent: Pick<KeptSubAgent, "status">,
  agentState: AgentState | undefined,
): KeptStateLabel {
  if (agentState === "hibernated" || agentState === "hibernating")
    return "idle";
  if (agentState === "starting" || agentState === "preparing_workspace")
    return "starting";
  return subAgent.status === "running" ? "running" : "idle";
}
