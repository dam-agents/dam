import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

const LIVE_POLL_MS = 5_000;
const OPEN_TURN_POLL_MS = 10_000;
const SETTLED_AFTER_MS = 5 * 60_000;

function keepUnlessUnavailable<T extends { available: boolean }>(
  previous: T | undefined,
): T | undefined {
  return previous?.available === false ? undefined : previous;
}

export function useTurns(
  agentId: string | null,
  sessionId: string | null,
  sinceHours: number,
) {
  return useQuery({
    ...trpc.telemetry.turns.queryOptions(
      agentId && sessionId ? { agentId, sessionId, sinceHours } : skipToken,
    ),
    staleTime: 2_000,
    refetchInterval: LIVE_POLL_MS,
    retry: false,
    placeholderData: keepUnlessUnavailable,
  });
}

export function useTurn(
  agentId: string | null,
  sessionId: string | null,
  from: string | null,
  to: string | null,
) {
  const startedMs = from === null ? Number.NaN : Date.parse(from);
  const inFlight =
    !Number.isNaN(startedMs) && Date.now() - startedMs < SETTLED_AFTER_MS;

  return useQuery({
    ...trpc.telemetry.turn.queryOptions(
      agentId && sessionId && from && to
        ? { agentId, sessionId, from, to }
        : skipToken,
    ),
    staleTime: inFlight ? 2_000 : 300_000,
    refetchInterval: inFlight ? OPEN_TURN_POLL_MS : false,
    retry: false,
    placeholderData: keepUnlessUnavailable,
  });
}
