import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/** Per-model spend across all of the user's agents over [from, to). */
export function useModelSpend(from: string, to: string) {
  return useQuery({
    ...trpc.metrics.spend.queryOptions({ from, to }),
    staleTime: 60_000,
    retry: false,
  });
}

/** Spend rolled up per agent across all of the user's agents over [from, to),
 *  sorted by cost descending. */
export function useSpendByAgent(from: string, to: string) {
  return useQuery({
    ...trpc.metrics.spendByAgent.queryOptions({ from, to }),
    staleTime: 60_000,
    retry: false,
  });
}

/** Metrics overview for one agent. Disabled while no agent is selected. */
export function useMetricsOverview(
  agentId: string | null,
  opts?: { sinceHours?: number; sessionId?: string; limit?: number },
) {
  return useQuery({
    ...trpc.metrics.overview.queryOptions(
      agentId ? { agentId, ...opts } : skipToken,
    ),
    refetchInterval: 15000,
    staleTime: 15000,
    retry: false,
  });
}
