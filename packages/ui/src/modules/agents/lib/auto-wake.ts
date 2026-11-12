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

export interface OpenWake {
  agentId: string | null;
  settled: boolean;
  woke: boolean;
}

export const NO_OPEN_WAKE: OpenWake = {
  agentId: null,
  settled: false,
  woke: false,
};

// UNIT_BOUNDARY_DESCRIPTION: a view open on an agent wakes it each time it finds it asleep, a stopped one included but not a disabled or over-budget one; switching agent is a new open. One sleep gets one wake: a wake already running counts as it, and a wake that fails leaves the agent asleep until it is seen awake again. A start that failed is retried once per open, so a start that keeps failing is not retried in a loop. An agent still falling asleep is woken once it is asleep. A hidden page follows the agent but wakes nothing; the sleep it found stays to be woken once the page is shown.
export function nextOpenWake(
  memo: OpenWake,
  agentId: string | null,
  agent:
    | Pick<AgentView, "state" | "overBudget" | "disabled" | "startFailure">
    | undefined,
  waking = false,
  visible = true,
): { memo: OpenWake; wake: boolean } {
  const open = memo.agentId === agentId ? memo : { ...NO_OPEN_WAKE, agentId };
  if (!agentId || !agent || agent.state === "hibernating")
    return { memo: open, wake: false };
  if (agent.state !== "hibernated")
    return { memo: { ...open, settled: false }, wake: false };
  if (open.settled || !visible) return { memo: open, wake: false };
  const wake =
    !waking &&
    !agent.overBudget &&
    !agent.disabled &&
    !(open.woke && agent.startFailure);
  return {
    memo: { agentId, settled: true, woke: open.woke || waking || wake },
    wake,
  };
}
