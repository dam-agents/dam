import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { totalCostUsd } from "../lib/format.js";
import { monthRange, monthStart } from "../lib/month-range.js";

/** The whole Usage tab in one read: per-model, per-agent, and per-day spend over
 *  [from, to) — across all of the user's agents, or one of them when `agentId`
 *  narrows it. Per-day rows are bucketed into the browser's local calendar days
 *  and are sparse — the caller zero-fills the month. One query so the page has a
 *  single loading/error state.
 *
 *  The range is part of the key, so paging months would otherwise be a cache
 *  miss and blank the whole tab; the previous month's rows stay put until the
 *  next arrive. Callers must dim on `isPlaceholderData`, or the figures read as
 *  belonging to the month just picked. */
export function useSpendBreakdown(
  from: string,
  to: string,
  timeZone: string,
  agentId?: string,
) {
  return useQuery({
    // Spread rather than pass `undefined`, so the unnarrowed key stays exactly
    // what it was before agent scoping existed and both surfaces share a cache
    // entry when they ask the same question.
    ...trpc.metrics.spendBreakdown.queryOptions({
      from,
      to,
      timeZone,
      ...(agentId ? { agentId } : {}),
    }),
    staleTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

/** This calendar month's total spend for one sandbox, for the Configure Sandbox
 *  nav's summary line. Deliberately built from the same inputs the Usage
 *  section's current-month read uses, so the two share one cache entry and
 *  opening the section costs no extra request. Skipped while no sandbox is
 *  selected — without that it would read every agent the caller owns. */
export function useAgentMonthSpend(agentId: string | null) {
  const { from, to } = monthRange(monthStart(new Date(), 0));
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return useQuery({
    ...trpc.metrics.spendBreakdown.queryOptions(
      agentId ? { from, to, timeZone, agentId } : skipToken,
    ),
    staleTime: 60_000,
    retry: false,
    select: (data) => totalCostUsd(data.byModel),
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
