import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { trpc } from "../../../trpc.js";
import { monthRange, monthStart } from "../lib/month-range.js";
import { keyAgentId } from "../lib/spend-key.js";
import { totalCostUsd } from "../lib/totals.js";
import { isMetricsUnavailable } from "../lib/unavailable.js";

export function useSpendBreakdown(
  from: string,
  to: string,
  timeZone: string,
  agentId?: string,
) {
  const [metricsDisabled, setMetricsDisabled] = useState(false);
  const query = useQuery({
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
  return {
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    isPlaceholderData: query.isPlaceholderData,
    isUnavailable,
  };
}

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
