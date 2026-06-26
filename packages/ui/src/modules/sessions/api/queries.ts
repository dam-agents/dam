import { skipToken, useQuery } from "@tanstack/react-query";
import {
  type SessionMode,
  SessionType,
  type SessionView,
} from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { listAgentSessions } from "./acp-session-ops.js";

const STATUS_POLL_MS = 5_000;

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
    experimentId: null,
    title: null,
    updatedAt: null,
    running: false,
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

// Seed the open session's live busy state into the list cache so its status dot
// stays correct the instant it stops being the open row — before the next poll.
export function setSessionRunning(
  agentId: string,
  sessionId: string,
  running: boolean,
): void {
  queryClient.setQueriesData<SessionView[]>(
    { queryKey: acpSessionsKeys.agentLists(agentId) },
    (prev) =>
      prev?.map((s) => (s.sessionId === sessionId ? { ...s, running } : s)),
  );
}

/**
 * Sessions list, read straight off the agent over ACP `session/list`
 * and decoded from `_meta.platform`. Regular and experiment-trial sessions are
 * always listed (so an arm's trial is reachable from its agent's sidebar);
 * schedule sessions are excluded; channel sessions are included only when asked. Pass
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
    activeSessionId?: string | null;
  },
) {
  const live = !!agentId && (options?.enabled ?? true);
  return useQuery({
    queryKey: acpSessionsKeys.list(agentId, includeChannel),
    queryFn: live
      ? async () => {
          const sessions = await listAgentSessions(agentId);
          const allowed: string[] = [
            SessionType.Regular,
            SessionType.ExperimentTrial,
          ];
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
    // Poll while running so per-session status dots and harness-set titles stay live.
    refetchInterval: live ? STATUS_POLL_MS : false,
    staleTime: STATUS_POLL_MS,
    meta: { errorToast: "Couldn't refresh session list" },
  });
}
