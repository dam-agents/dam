import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/**
 * An agent's reconciled skills state (installed / standalone / publishes).
 * Read-only; degrades to no data (rather than throwing) while the pod is asleep.
 * Polls at the same 5s cadence as the chat skills panel.
 */
export function useSkillsState(agentId: string | null) {
  return useQuery({
    ...trpc.skills.state.queryOptions(agentId ? { agentId } : skipToken),
    retry: false,
    refetchInterval: 5000,
  });
}
