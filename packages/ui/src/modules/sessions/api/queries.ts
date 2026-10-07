import {
  type InfiniteData,
  skipToken,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import type { SessionListCursor, SessionListQuery } from "agent-runtime-api";
import {
  SESSION_CATEGORIES,
  type SessionCategory,
  type SessionMode,
  SessionType,
  type SessionView,
} from "api-server-api";
import { useMemo } from "react";

import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { useAgentLacksLiveUpdates } from "../../agents/api/queries.js";
import {
  findAgentSession,
  listAgentSessionPage,
  type SessionViewPage,
} from "./acp-session-ops.js";
import { acpSessionsKeys } from "./keys.js";

const SESSION_PAGE_SIZE = 50;

type SessionPages = InfiniteData<SessionViewPage, SessionListCursor | null>;

function updateListedSessions(
  agentId: string,
  update: (sessions: SessionView[], pageIndex: number) => SessionView[],
): void {
  queryClient.setQueriesData<SessionPages>(
    { queryKey: acpSessionsKeys.pages(agentId) },
    (prev) =>
      prev && {
        ...prev,
        pages: prev.pages.map((page, i) => ({
          ...page,
          sessions: update(page.sessions, i),
        })),
      },
  );
}

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
    title: null,
    updatedAt: null,
    running,
  };
  queryClient.setQueriesData<SessionPages>(
    { queryKey: acpSessionsKeys.pages(agentId) },
    (prev) => {
      if (!prev) return prev;
      if (
        prev.pages.some((p) =>
          p.sessions.some((s) => s.sessionId === sessionId),
        )
      )
        return prev;
      const [first, ...rest] = prev.pages;
      if (!first) return prev;
      return {
        ...prev,
        pages: [{ ...first, sessions: [stub, ...first.sessions] }, ...rest],
      };
    },
  );
}

export function removeSessionFromCache(
  agentId: string,
  sessionId: string,
): void {
  updateListedSessions(agentId, (sessions) =>
    sessions.filter((s) => s.sessionId !== sessionId),
  );
}

export function setSessionSeen(agentId: string, sessionId: string): void {
  updateListedSessions(agentId, (sessions) =>
    sessions.map((s) =>
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
  updateListedSessions(agentId, (sessions) =>
    sessions.map((s) => (s.sessionId === sessionId ? { ...s, running } : s)),
  );
}

function withActiveStub(
  fresh: SessionViewPage,
  prev: SessionPages | undefined,
  activeId: string | null | undefined,
): SessionViewPage {
  if (!activeId || fresh.sessions.some((s) => s.sessionId === activeId))
    return fresh;
  const stub = prev?.pages[0]?.sessions.find((s) => s.sessionId === activeId);
  return stub ? { ...fresh, sessions: [stub, ...fresh.sessions] } : fresh;
}

function uniqueSessions(pages: readonly SessionViewPage[]): SessionView[] {
  const seen = new Set<string>();
  const out: SessionView[] = [];
  for (const page of pages) {
    for (const session of page.sessions) {
      if (seen.has(session.sessionId)) continue;
      seen.add(session.sessionId);
      out.push(session);
    }
  }
  return out;
}

export function useSessionPages(
  agentId: string | null,
  categories: readonly SessionCategory[],
  options?: {
    enabled?: boolean;
    activeSessionId?: string | null;
  },
) {
  const compat = useAgentLacksLiveUpdates(agentId);
  const live = !!agentId && (options?.enabled ?? true);
  const queryKey = acpSessionsKeys.pagesOf(agentId, categories);
  const query = useInfiniteQuery({
    queryKey,
    queryFn: live
      ? async ({ pageParam }) => {
          const page = await listAgentSessionPage(agentId, {
            categories: [...categories],
            ...(pageParam && { after: pageParam }),
            limit: SESSION_PAGE_SIZE,
          });
          if (pageParam) return page;
          const coversAll =
            categories.length === SESSION_CATEGORIES.length &&
            page.nextCursor === null;
          const store = useStore.getState();
          if (coversAll && store.selectedAgent === agentId) {
            store.pruneDrafts(
              agentId,
              page.sessions.map((s) => s.sessionId),
            );
          }
          return withActiveStub(
            page,
            queryClient.getQueryData<SessionPages>(queryKey),
            options?.activeSessionId,
          );
        }
      : skipToken,
    initialPageParam: null as SessionListCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchOnMount: "always",
    refetchInterval: live && compat ? 5_000 : false,
    staleTime: 5_000,
    meta: { errorToast: "Couldn't refresh session list" },
  });
  const sessions = useMemo(
    () => (query.data ? uniqueSessions(query.data.pages) : undefined),
    [query.data],
  );
  return { ...query, sessions };
}

export function useAgentSessionQuery(
  agentId: string | null,
  query: SessionListQuery,
  options?: { enabled?: boolean },
) {
  const live = !!agentId && (options?.enabled ?? true);
  return useQuery({
    queryKey: acpSessionsKeys.query(agentId, query),
    queryFn: live
      ? async () => (await listAgentSessionPage(agentId, query)).sessions
      : skipToken,
    staleTime: 5_000,
  });
}

export function useAgentSession(
  agentId: string | null,
  sessionId: string | null,
  options?: { enabled?: boolean },
) {
  const live = !!agentId && !!sessionId && (options?.enabled ?? true);
  return useQuery({
    queryKey: acpSessionsKeys.session(agentId, sessionId),
    queryFn:
      live && sessionId
        ? () => findAgentSession(agentId, sessionId)
        : skipToken,
    staleTime: 5_000,
  });
}
