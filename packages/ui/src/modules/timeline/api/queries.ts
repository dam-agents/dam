import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useTraces(
  agentId: string | null,
  sessionId: string | null,
  sinceHours: number,
  enabled: boolean,
) {
  return useQuery({
    ...trpc.timeline.traces.queryOptions(
      agentId && enabled
        ? {
            agentId,
            sinceHours,
            ...(sessionId ? { sessionId } : {}),
          }
        : skipToken,
    ),
    staleTime: 30_000,
    retry: false,
  });
}

export function useTrace(
  agentId: string | null,
  traceId: string | null,
  startedAt: string | null,
) {
  return useQuery({
    ...trpc.timeline.trace.queryOptions(
      agentId && traceId
        ? {
            agentId,
            traceId,
            ...(startedAt ? { startedAt } : {}),
          }
        : skipToken,
    ),
    staleTime: 300_000,
    retry: false,
  });
}
