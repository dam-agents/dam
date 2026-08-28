import { skipToken, useQuery } from "@tanstack/react-query";
import {
  type SessionMode,
  SessionType,
  type SessionView,
} from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { useAgentLacksLiveUpdates } from "../../agents/api/queries.js";
import {
  listAgentSessions,
  listAgentSessionsOverAcp,
} from "./acp-session-ops.js";

export interface SessionListInclude {
  channels: boolean;
  scheduled: boolean;
}

export const acpSessionsKeys = {
  all: ["acp-sessions"] as const,
  agentLists: (agentId: string | null) =>
    [...acpSessionsKeys.all, agentId] as const,
  list: (agentId: string | null, include: SessionListInclude) =>
    [...acpSessionsKeys.agentLists(agentId), include] as const,
};

export function optimisticInsertSession(
  agentId: string,
  sessionId: string,
  mode: SessionMode,
  running = false,
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
    running,
  };
  queryClient.setQueriesData<SessionView[]>(
    { queryKey: acpSessionsKeys.agentLists(agentId) },
    (prev) =>
      prev?.some((s) => s.sessionId === sessionId)
        ? prev
        : [stub, ...(prev ?? [])],
  );
}

export function removeSessionFromCache(
  agentId: string,
  sessionId: string,
): void {
  queryClient.setQueriesData<SessionView[]>(
    { queryKey: acpSessionsKeys.agentLists(agentId) },
    (prev) => prev?.filter((s) => s.sessionId !== sessionId),
  );
}

export function setSessionSeen(agentId: string, sessionId: string): void {
  queryClient.setQueriesData<SessionView[]>(
    { queryKey: acpSessionsKeys.agentLists(agentId) },
    (prev) =>
      prev?.map((s) =>
        s.sessionId === sessionId
          ? { ...s, seenAt: s.updatedAt ?? s.createdAt }
          : s,
      ),
  );
}

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

export function useAcpSessions(
  agentId: string | null,
  include: SessionListInclude,
  options?: {
    enabled?: boolean;
    activeSessionId?: string | null;
  },
) {
  const compat = useAgentLacksLiveUpdates(agentId);
  const live = !!agentId && (options?.enabled ?? true);
  return useQuery({
    queryKey: acpSessionsKeys.list(agentId, include),
    queryFn: live
      ? async () => {
          const sessions = compat
            ? await listAgentSessionsOverAcp(agentId)
            : await listAgentSessions(agentId);
          const store = useStore.getState();
          if (store.selectedAgent === agentId) {
            store.pruneDrafts(
              agentId,
              sessions.map((s) => s.sessionId),
            );
          }
          const allowed: string[] = [
            SessionType.Regular,
            SessionType.ExperimentExecute,
          ];
          if (include.channels)
            allowed.push(SessionType.ChannelSlack, SessionType.ChannelTelegram);
          if (include.scheduled) allowed.push(SessionType.ScheduleCron);
          const fresh = sessions.filter((s) => allowed.includes(s.type));
          const activeId = options?.activeSessionId;
          if (!activeId || fresh.some((s) => s.sessionId === activeId))
            return fresh;
          const prev = queryClient.getQueryData<SessionView[]>(
            acpSessionsKeys.list(agentId, include),
          );
          const stub = prev?.find((s) => s.sessionId === activeId);
          return stub ? [stub, ...fresh] : fresh;
        }
      : skipToken,
    refetchOnMount: "always",
    refetchInterval: live && compat ? 5_000 : false,
    staleTime: 5_000,
    meta: { errorToast: "Couldn't refresh session list" },
  });
}
