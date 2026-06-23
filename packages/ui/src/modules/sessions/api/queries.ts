import { skipToken, useQuery } from "@tanstack/react-query";
import {
  type SessionMode,
  SessionType,
  type SessionView,
} from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { listAgentSessions } from "./acp-session-ops.js";

const TERMINAL_RECONCILE_POLL_MS = 4_000;
const TERMINAL_RECONCILE_DEADLINE_MS = 60_000;

export const acpSessionsKeys = {
  all: ["acp-sessions"] as const,
  agentLists: (agentId: string | null) =>
    [...acpSessionsKeys.all, agentId] as const,
  list: (agentId: string | null, includeChannel: boolean) =>
    [...acpSessionsKeys.agentLists(agentId), { includeChannel }] as const,
};

// Optimistic insert so the sidebar shows the row immediately; the next refetch reconciles.
export function optimisticInsertSession(
  agentId: string,
  sessionId: string,
  mode: SessionMode,
): void {
  const stub: SessionView = {
    sessionId,
    agentId,
    type: SessionType.Regular,
    mode,
    createdAt: new Date().toISOString(),
    scheduleId: null,
    title: null,
    updatedAt: null,
  };
  queryClient.setQueriesData<SessionView[]>(
    { queryKey: acpSessionsKeys.agentLists(agentId) },
    (prev) =>
      prev?.some((s) => s.sessionId === sessionId)
        ? prev
        : [stub, ...(prev ?? [])],
  );
}

// Remove the session from the sidebar list cache so the row disappears immediately; the invalidate that follows reconciles.
export function removeSessionFromCache(
  agentId: string,
  sessionId: string,
): void {
  queryClient.setQueriesData<SessionView[]>(
    { queryKey: acpSessionsKeys.agentLists(agentId) },
    (prev) => prev?.filter((s) => s.sessionId !== sessionId),
  );
}

/**
 * Sessions list, read straight off the agent over ACP `session/list`
 * and decoded from `_meta.platform`. Schedule sessions are excluded from the
 * main list; channel sessions are included only when asked. Pass
 * `enabled: false` (e.g. while the agent is waking) to keep the query in cache
 * without firing requests.
 *
 * `refetchOnMount: "always"` because the title is harness-set after the first
 * turn — a returning user must see the updated title without a manual refresh.
 */
export function useAcpSessions(
  agentId: string | null,
  includeChannel: boolean,
  options?: {
    enabled?: boolean;
    pollActive?: boolean;
    activeSessionId?: string | null;
  },
) {
  const live = !!agentId && (options?.enabled ?? true);
  return useQuery({
    queryKey: acpSessionsKeys.list(agentId, includeChannel),
    queryFn: live
      ? async () => {
          const sessions = await listAgentSessions(agentId);
          const allowed: string[] = [SessionType.Regular];
          if (includeChannel)
            allowed.push(SessionType.ChannelSlack, SessionType.ChannelTelegram);
          const fresh = sessions.filter((s) => allowed.includes(s.type));
          // Keep the active session's optimistic stub if not fetched so a refetch can't drop it.
          const activeId = options?.activeSessionId;
          if (!activeId || fresh.some((s) => s.sessionId === activeId))
            return fresh;
          const prev = queryClient.getQueryData<SessionView[]>(
            acpSessionsKeys.list(agentId, includeChannel),
          );
          const stub = prev?.find((s) => s.sessionId === activeId);
          return stub ? [stub, ...fresh] : fresh;
        }
      : skipToken,
    refetchOnMount: "always",
    // Terminal mode has no per-turn refresh; poll the active session until it reconciles to a titled listed session.
    refetchInterval: options?.pollActive
      ? (query) => {
          const id = options.activeSessionId;
          if (!id) return false;
          const active = (query.state.data ?? []).find(
            (s) => s.sessionId === id,
          );
          if (!active || active.title) return false;
          const age = Date.now() - Date.parse(active.createdAt);
          return age < TERMINAL_RECONCILE_DEADLINE_MS
            ? TERMINAL_RECONCILE_POLL_MS
            : false;
        }
      : false,
    staleTime: 5_000,
    meta: { errorToast: "Couldn't refresh session list" },
  });
}
