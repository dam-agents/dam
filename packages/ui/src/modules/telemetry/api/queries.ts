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

/**
 * UNIT_BOUNDARY_DESCRIPTION: the session view keeps this mounted for the whole
 * life of an open tab, so an idle session that can produce no new turn must stop
 * polling. `live` is the caller's read of the conversation — a reply streaming,
 * or one that settled within the last few minutes — so the poll keeps running
 * while the store ingests an exchange that just finished, even before its first
 * turn has landed, and stops once the conversation goes quiet.
 */
export function useTurns(
  agentId: string | null,
  sessionId: string | null,
  sinceHours: number,
  live: boolean,
) {
  return useQuery({
    ...trpc.telemetry.turns.queryOptions(
      agentId && sessionId ? { agentId, sessionId, sinceHours } : skipToken,
    ),
    staleTime: 2_000,
    refetchInterval: live ? LIVE_POLL_MS : false,
    retry: false,
    placeholderData: keepUnlessUnavailable,
  });
}

export function useTurn(
  agentId: string | null,
  sessionId: string | null,
  from: string | null,
  to: string | null,
  promptId: string | null,
) {
  const startedMs = from === null ? Number.NaN : Date.parse(from);
  const inFlight =
    !Number.isNaN(startedMs) && Date.now() - startedMs < SETTLED_AFTER_MS;

  return useQuery({
    ...trpc.telemetry.turn.queryOptions(
      agentId && sessionId && from && to
        ? {
            agentId,
            sessionId,
            from,
            to,
            ...(promptId === null ? {} : { promptId }),
          }
        : skipToken,
    ),
    staleTime: inFlight ? 2_000 : 300_000,
    refetchInterval: inFlight ? OPEN_TURN_POLL_MS : false,
    retry: false,
    placeholderData: keepUnlessUnavailable,
  });
}
