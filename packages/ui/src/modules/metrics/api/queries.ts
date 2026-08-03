import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/** The whole Usage tab in one read: per-model, per-agent, and per-day spend
 *  across all of the user's agents over [from, to). Per-day rows are bucketed
 *  into the browser's local calendar days and are sparse — the caller zero-fills
 *  the month. One query so the page has a single loading/error state. */
export function useSpendBreakdown(from: string, to: string, timeZone: string) {
  return useQuery({
    ...trpc.metrics.spendBreakdown.queryOptions({ from, to, timeZone }),
    staleTime: 60_000,
    retry: false,
  });
}

/** Per-session cost lookup for the sessions sidebar, keyed by ACP session id. */
export function useSessionCosts(agentId: string | null, enabled: boolean) {
  return useQuery({
    ...trpc.metrics.overview.queryOptions(
      agentId && enabled ? { agentId, limit: 1 } : skipToken,
    ),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
    select: (data) =>
      new Map(data.runtimeBySession.map((r) => [r.sessionId, r])),
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
