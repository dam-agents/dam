import type { AgentView } from "../../../types.js";

// UNIT_BOUNDARY_DESCRIPTION: each open of a sleeping agent's chat wakes it once, a stopped one included; leaving the chat or switching agent ends the open. An agent that falls asleep while its chat stays open, or whose wake fails, is not woken again until the next open.
export function nextAutoWake(
  decidedFor: string | null,
  agentId: string | null,
  agent: Pick<AgentView, "state" | "overBudget"> | undefined,
): { decidedFor: string | null; wake: boolean } {
  if (!agentId) return { decidedFor: null, wake: false };
  if (decidedFor === agentId || !agent) return { decidedFor, wake: false };
  return {
    decidedFor: agentId,
    wake: agent.state === "hibernated" && !agent.overBudget,
  };
}
