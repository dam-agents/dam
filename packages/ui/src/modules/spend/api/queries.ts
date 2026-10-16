import {
  keepPreviousData,
  skipToken,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import {
  SPEND_TURNS_MAX_SPAN_DAYS,
  SPEND_TURNS_MAX_WINDOWS,
  type SpendAmount,
  type SpendBreakdownInput,
  type SpendSessionRow,
  type SpendSessions,
  type SpendTurns,
} from "api-server-api";
import { useMemo } from "react";

import { trpc } from "../../../trpc.js";
import { sessionCostPages } from "../../metrics/lib/session-cost-pages.js";
import { utcDayOf } from "../lib/utc-day.js";

const SPEND_REFRESH_MS = 15_000;
const LATEST_SESSIONS_REFRESH_MS = 60_000;
const OLDER_SESSIONS_STALE_MS = 5 * 60_000;
const OPEN_TURN_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

export function useOwnerSpendStatus() {
  return useQuery({
    ...trpc.spend.status.queryOptions(),
    refetchInterval: SPEND_REFRESH_MS,
  });
}

export function useAgentSpendStatus(agentId: string | null) {
  return useQuery({
    ...trpc.spend.status.queryOptions(agentId ? { agentId } : skipToken),
    refetchInterval: SPEND_REFRESH_MS,
  });
}

export function useSpendBreakdown(input: SpendBreakdownInput) {
  return useQuery({
    ...trpc.spend.breakdown.queryOptions(input),
    refetchInterval: SPEND_REFRESH_MS * 2,
    placeholderData: keepPreviousData,
  });
}

export function useSpendMetering() {
  return useQuery({
    ...trpc.spend.metering.queryOptions(),
    staleTime: Infinity,
  });
}

function rowsBySession(
  results: readonly { data?: SpendSessions }[],
): Map<string, SpendSessionRow> {
  return new Map(
    results.flatMap((r) => r.data?.rows ?? []).map((r) => [r.sessionId, r]),
  );
}

export function useSessionSpend(
  agentId: string | null,
  sessions: readonly {
    sessionId: string;
    createdAt: string;
    updatedAt?: string | null;
  }[],
) {
  const pages = useMemo(() => sessionCostPages(sessions), [sessions]);
  return useQueries({
    queries: pages.map((page, index) => ({
      ...trpc.spend.sessions.queryOptions(
        agentId
          ? {
              agentId,
              sessionIds: page.sessionIds,
              limit: page.sessionIds.length,
              ...(page.from && { from: utcDayOf(new Date(page.from)) }),
            }
          : skipToken,
      ),
      staleTime:
        index === 0 ? LATEST_SESSIONS_REFRESH_MS : OLDER_SESSIONS_STALE_MS,
      refetchInterval: index === 0 ? LATEST_SESSIONS_REFRESH_MS : false,
      placeholderData: keepPreviousData,
      retry: false,
    })),
    combine: rowsBySession,
  });
}

interface TurnWindow {
  turnId: string;
  startedAt: string;
  endedAt: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the newest turns that one read can carry: at most
 * the read's window count, within its span back from the newest turn's end.
 */
function readableTurns(turns: readonly TurnWindow[]): TurnWindow[] {
  const newest = [...turns].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  const end = Math.max(...newest.map((t) => Date.parse(t.endedAt)));
  return newest
    .filter(
      (t) => end - Date.parse(t.startedAt) < SPEND_TURNS_MAX_SPAN_DAYS * DAY_MS,
    )
    .slice(0, SPEND_TURNS_MAX_WINDOWS);
}

function amountsByTurn(
  turns: readonly TurnWindow[],
): (data: SpendTurns) => Map<string, SpendAmount[]> {
  return (data) => {
    const byWindow = new Map(data.windows.map((w) => [w.from, w.amounts]));
    return new Map(
      turns.flatMap((t) => {
        const amounts = byWindow.get(t.startedAt);
        return amounts ? [[t.turnId, amounts] as const] : [];
      }),
    );
  };
}

export function useTurnSpend(
  agentId: string | null,
  sessionId: string | null,
  turns: readonly TurnWindow[],
) {
  const readable = useMemo(() => readableTurns(turns), [turns]);
  const open = readable.some(
    (t) => Date.now() - Date.parse(t.endedAt) < OPEN_TURN_MS,
  );
  const select = useMemo(() => amountsByTurn(readable), [readable]);
  return useQuery({
    ...trpc.spend.turns.queryOptions(
      agentId && readable.length > 0
        ? {
            agentId,
            ...(sessionId && { sessionId }),
            windows: readable.map((t) => ({
              from: t.startedAt,
              to: t.endedAt,
            })),
          }
        : skipToken,
    ),
    select,
    refetchInterval: open ? SPEND_REFRESH_MS : false,
    placeholderData: keepPreviousData,
    retry: false,
  });
}
