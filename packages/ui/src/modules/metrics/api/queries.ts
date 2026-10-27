import { skipToken, useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import type { SpendBreakdownInput } from "api-server-api";
import { useEffect, useState } from "react";

import { trpc } from "../../../trpc.js";
import { legacySpendBreakdown } from "../lib/measured-spend.js";
import { monthRange, monthStart } from "../lib/month-range.js";
import { keyAgentId } from "../lib/spend-key.js";
import { totalCostUsd } from "../lib/totals.js";

export function useSpendBreakdown(
  range: SpendBreakdownInput,
  agentId?: string,
) {
  const [metricsDisabled, setMetricsDisabled] = useState(false);
  const query = useQuery({
    ...trpc.spend.breakdown.queryOptions({
      ...range,
      ...(agentId ? { agentId } : {}),
    }),
    select: legacySpendBreakdown,
    enabled: !metricsDisabled,
    staleTime: 60_000,
    retry: false,
    placeholderData: (previous, previousQuery) =>
      keyAgentId(previousQuery?.queryKey) === agentId ? previous : undefined,
  });
  const isUnavailable =
    metricsDisabled ||
    (query.error instanceof TRPCClientError &&
      query.error.data?.code === "PRECONDITION_FAILED");
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
  return useQuery({
    ...trpc.spend.breakdown.queryOptions(
      agentId ? { from, to, agentId } : skipToken,
    ),
    staleTime: 60_000,
    retry: false,
    select: (data) => totalCostUsd(legacySpendBreakdown(data).byModel),
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
