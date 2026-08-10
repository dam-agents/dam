import { useEffect, useRef } from "react";

import { useAgentsList } from "../api/queries.js";
import { useWakeAgent } from "./use-wake-agent.js";

/**
 * Starts a sleeping sandbox when its chat opens, so clicking a sandbox lands in
 * a working chat instead of an overlay asking for one more click. The platform
 * already wakes on a connect-driven ACP frame — this only drops the UI's own
 * demand for an explicit Start.
 *
 * Two states are left to the user on purpose: a parked sandbox
 * (`overBudget`) needs Start as its deliberate retry through the budget gate,
 * and an `error` sandbox needs Restart plus an error the user has actually read.
 */
export function useAutoWakeOnOpen(agentId: string | null): void {
  const agents = useAgentsList();
  const { wake } = useWakeAgent();
  // One attempt per sandbox: a failed wake clears the optimistic entry, and
  // without this the next list poll would fire it again.
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    if (!agentId || attempted.current.has(agentId)) return;
    const agent = agents.find((a) => a.id === agentId);
    if (!agent || agent.state !== "hibernated" || agent.overBudget) return;
    attempted.current.add(agentId);
    wake(agentId);
  }, [agentId, agents, wake]);
}
