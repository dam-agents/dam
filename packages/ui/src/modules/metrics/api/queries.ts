import { useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect, useState } from "react";

import { trpc } from "../../../trpc.js";
import { keyAgentId } from "../lib/spend-key.js";

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
    isFetching: query.isFetching,
    isError: query.isError,
    isPlaceholderData: query.isPlaceholderData,
    isUnavailable,
  };
}
