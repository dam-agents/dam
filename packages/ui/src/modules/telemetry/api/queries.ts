import { skipToken, useQuery } from "@tanstack/react-query";
import type { TelemetryTurnsResult } from "api-server-api";

import { trpc } from "../../../trpc.js";

const LIVE_POLL_MS = 5_000;
const OPEN_TURN_POLL_MS = 10_000;
const SETTLED_AFTER_MS = 5 * 60_000;

function keepUnlessUnavailable<T extends { available: boolean }>(
  previous: T | undefined,
): T | undefined {
  return previous?.available === false ? undefined : previous;
}

const newestTurnStart = (result: TelemetryTurnsResult | undefined): number => {
  if (result === undefined || !result.available) return Number.NaN;
  const at = result.turns[result.turns.length - 1]?.startedAt;
  return at === undefined ? Number.NaN : Date.parse(at);
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the session view keeps this mounted for the whole
 * life of an open tab, so an idle session that can produce no new turn must stop
 * polling. It stays live while a reply is streaming, and for one settle window
 * past the newest turn so the store has time to ingest the exchange that just
 * finished.
 */
export function useTurns(
  agentId: string | null,
  sessionId: string | null,
  sinceHours: number,
  streaming: boolean,
) {
  return useQuery({
    ...trpc.telemetry.turns.queryOptions(
      agentId && sessionId ? { agentId, sessionId, sinceHours } : skipToken,
    ),
    staleTime: 2_000,
    refetchInterval: (query) => {
      if (streaming) return LIVE_POLL_MS;
      const newest = newestTurnStart(query.state.data);
      const recent =
        !Number.isNaN(newest) && Date.now() - newest < SETTLED_AFTER_MS;
      return recent ? LIVE_POLL_MS : false;
    },
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
