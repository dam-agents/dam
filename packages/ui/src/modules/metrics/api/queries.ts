import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { trpc } from "../../../trpc.js";
import { monthRange, monthStart } from "../lib/month-range.js";
import { keyAgentId } from "../lib/spend-key.js";
import { totalCostUsd } from "../lib/totals.js";
import { isMetricsUnavailable } from "../lib/unavailable.js";

/** The whole Usage tab in one read: per-model, per-agent, and per-day spend over
 *  [from, to) — across all of the user's agents, or one of them when `agentId`
 *  narrows it. Per-day rows are bucketed into the browser's local calendar days
 *  and are sparse — the caller zero-fills the month. One query so the page has a
 *  single loading/error state.
 *
 *  The range is part of the key, so paging months would otherwise be a cache
 *  miss and blank the whole surface; the previous month's rows stay put until
 *  the next arrive. Callers must mark the figures while `isPlaceholderData`, or
 *  they read as belonging to the month just picked. `agentId` is part of the key
 *  too, and a stand-in from another agent would be a wrong number rather than a
 *  stale one — so only a same-agent predecessor may fill in.
 *
 *  `isUnavailable` latches the deployment-level "metrics are off here" verdict:
 *  once seen, no further range fires a request we already know will fail. */
export function useSpendBreakdown(
  from: string,
  to: string,
  timeZone: string,
  agentId?: string,
) {
  const [metricsDisabled, setMetricsDisabled] = useState(false);
  const query = useQuery({
    // Spread rather than pass `undefined`, so the unnarrowed key stays exactly
    // what it was before agent scoping existed and both surfaces share a cache
    // entry when they ask the same question.
    ...trpc.metrics.spendBreakdown.queryOptions({
      from,
      to,
      timeZone,
      ...(agentId ? { agentId } : {}),
    }),
    enabled: !metricsDisabled,
    staleTime: 60_000,
    retry: false,
    placeholderData: (previous, previousQuery) =>
      keyAgentId(previousQuery?.queryKey) === agentId ? previous : undefined,
  });
  const isUnavailable = metricsDisabled || isMetricsUnavailable(query.error);
  useEffect(() => {
    if (isUnavailable) setMetricsDisabled(true);
  }, [isUnavailable]);
  // Named fields rather than a spread: spreading the result would read every
  // property and so opt the page out of React Query's render tracking.
  return {
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    // True while the figures on screen belong to the previously viewed month.
    isPlaceholderData: query.isPlaceholderData,
    isUnavailable,
  };
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
