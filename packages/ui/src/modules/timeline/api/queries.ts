import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

const LIVE_POLL_MS = 5_000;
const OPEN_TRACE_POLL_MS = 10_000;
const SETTLED_AFTER_MS = 5 * 60_000;

function keepUnlessUnavailable<T extends { available: boolean }>(
  previous: T | undefined,
): T | undefined {
  return previous?.available === false ? undefined : previous;
}

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
    staleTime: 2_000,
    refetchInterval: LIVE_POLL_MS,
    retry: false,
    placeholderData: keepUnlessUnavailable,
  });
}

export function useTrace(
  agentId: string | null,
  traceId: string | null,
  startedAt: string | null,
) {
  const startedMs = startedAt === null ? Number.NaN : Date.parse(startedAt);
  const inFlight =
    !Number.isNaN(startedMs) && Date.now() - startedMs < SETTLED_AFTER_MS;

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
    staleTime: inFlight ? 2_000 : 300_000,
    refetchInterval: inFlight ? OPEN_TRACE_POLL_MS : false,
    retry: false,
    placeholderData: keepUnlessUnavailable,
  });
}
