import type { AgentView } from "../../../types.js";

// UNIT_BOUNDARY_DESCRIPTION: each open of a sleeping agent's chat or sidebar session list wakes it once, a stopped one included but not a disabled one; leaving the view or switching agent ends the open. An agent still falling asleep when the view opens is woken once it is asleep. A wake already running when the open decides, from another view or a click, counts as the open's wake. An agent that falls asleep while the view stays open, or whose wake fails, is not woken again until the next open.
export function nextAutoWake(
  decidedFor: string | null,
  agentId: string | null,
  agent: Pick<AgentView, "state" | "overBudget" | "disabled"> | undefined,
  waking = false,
): { decidedFor: string | null; wake: boolean } {
  if (!agentId) return { decidedFor: null, wake: false };
  if (decidedFor === agentId) return { decidedFor, wake: false };
  if (!agent || agent.state === "hibernating")
    return { decidedFor: null, wake: false };
  return {
    decidedFor: agentId,
    wake:
      !waking &&
      agent.state === "hibernated" &&
      !agent.overBudget &&
      !agent.disabled,
  };
}
