import {
  keepPreviousData,
  skipToken,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import type { SessionRuntime } from "api-server-api";
import { useEffect, useMemo, useState } from "react";

import { trpc } from "../../../trpc.js";
import { monthRange, monthStart } from "../lib/month-range.js";
import { sessionCostPages } from "../lib/session-cost-pages.js";
import { keyAgentId } from "../lib/spend-key.js";
import { totalCostUsd } from "../lib/totals.js";

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

const LATEST_COSTS_REFRESH_MS = 60_000;
const OLDER_COSTS_STALE_MS = 5 * 60_000;

function costsBySession(
  results: readonly { data?: SessionRuntime[] }[],
): Map<string, SessionRuntime> {
  return new Map(
    results.flatMap((r) => r.data ?? []).map((r) => [r.sessionId, r]),
  );
}

export function useSessionCosts(
  agentId: string | null,
  sessions: readonly { sessionId: string; createdAt: string }[],
) {
  const pages = useMemo(() => sessionCostPages(sessions), [sessions]);
  return useQueries({
    queries: pages.map((page, index) => ({
      ...trpc.metrics.sessionCosts.queryOptions(
        agentId ? { agentId, ...page } : skipToken,
      ),
      staleTime: index === 0 ? LATEST_COSTS_REFRESH_MS : OLDER_COSTS_STALE_MS,
      refetchInterval: index === 0 ? LATEST_COSTS_REFRESH_MS : false,
      placeholderData: keepPreviousData,
      retry: false,
    })),
    combine: costsBySession,
  });
}
