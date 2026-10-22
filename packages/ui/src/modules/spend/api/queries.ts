import {
  keepPreviousData,
  skipToken,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import {
  type SpendAmount,
  type SpendBreakdownInput,
  type SpendSessionRow,
  type SpendSessions,
  type SpendTurns,
  type SpendTurnWindow,
  spendTurnWindows,
} from "api-server-api";
import { useMemo } from "react";

import { trpc } from "../../../trpc.js";
import { sessionCostPages } from "../../metrics/lib/session-cost-pages.js";
import { utcDayOf } from "../lib/utc-day.js";

const SPEND_REFRESH_MS = 15_000;
const LATEST_SESSIONS_REFRESH_MS = 60_000;
const OLDER_SESSIONS_STALE_MS = 5 * 60_000;
const OPEN_TURN_MS = 10 * 60_000;

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

export function useSubAgentSpend(
  input: { agentId: string; from: string; to: string },
  limit: number,
) {
  return useQuery({
    ...trpc.spend.subAgents.queryOptions(
      limit > 0 ? { ...input, limit } : skipToken,
    ),
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

function amountsByTurn(
  readable: readonly SpendTurnWindow<TurnWindow>[],
): (data: SpendTurns) => Map<string, SpendAmount[]> {
  return (data) => {
    const byWindow = new Map(data.windows.map((w) => [w.from, w.amounts]));
    return new Map(
      readable.flatMap(({ turn, from }) => {
        const amounts = byWindow.get(from);
        return amounts ? [[turn.turnId, amounts] as const] : [];
      }),
    );
  };
}

export function useTurnSpend(
  agentId: string | null,
  sessionId: string | null,
  turns: readonly TurnWindow[],
) {
  const readable = useMemo(() => spendTurnWindows(turns), [turns]);
  const open = readable.some(
    ({ turn }) => Date.now() - Date.parse(turn.endedAt) < OPEN_TURN_MS,
  );
  const select = useMemo(() => amountsByTurn(readable), [readable]);
  return useQuery({
    ...trpc.spend.turns.queryOptions(
      agentId && readable.length > 0
        ? {
            agentId,
            ...(sessionId && { sessionId }),
            windows: readable.map(({ from, to }) => ({ from, to })),
          }
        : skipToken,
    ),
    select,
    refetchInterval: open ? SPEND_REFRESH_MS : false,
    placeholderData: keepPreviousData,
    retry: false,
  });
}
