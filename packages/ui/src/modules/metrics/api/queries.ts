import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect, useState } from "react";

import { trpc } from "../../../trpc.js";

/** A deployment without a telemetry store answers every metrics read with
 *  PRECONDITION_FAILED. That is a verdict about the deployment, not about the
 *  range that happened to be asked for. */
function isMetricsDisabled(error: unknown): boolean {
  return (
    error instanceof TRPCClientError &&
    error.data?.code === "PRECONDITION_FAILED"
  );
}

/** The whole Usage tab in one read: per-model, per-agent, and per-day spend
 *  across all of the user's agents over [from, to). Per-day rows are bucketed
 *  into the browser's local calendar days and are sparse — the caller zero-fills
 *  the month. One query so the page has a single loading/error state.
 *
 *  `isUnavailable` latches the deployment-level "metrics are off here" verdict:
 *  once seen, no further range fires a request we already know will fail. */
export function useSpendBreakdown(from: string, to: string, timeZone: string) {
  const [metricsDisabled, setMetricsDisabled] = useState(false);
  const query = useQuery({
    ...trpc.metrics.spendBreakdown.queryOptions({ from, to, timeZone }),
    enabled: !metricsDisabled,
    staleTime: 60_000,
    retry: false,
    // Each range is its own query key, so a fresh key starts with no cached
    // data — without this, switching range tears the page down to its skeleton
    // every time. Keep the last figures on screen until the new ones land.
    placeholderData: keepPreviousData,
  });
  const isUnavailable = metricsDisabled || isMetricsDisabled(query.error);
  useEffect(() => {
    if (isUnavailable) setMetricsDisabled(true);
  }, [isUnavailable]);
  // Named fields rather than a spread: spreading the result would read every
  // property and so opt the page out of React Query's render tracking.
  return {
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    // True while the figures on screen belong to the previously viewed range.
    isPlaceholderData: query.isPlaceholderData,
    isUnavailable,
  };
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
