import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";
import { useAgents, useAgentsList } from "../../agents/api/queries.js";
import { useApprovalsForOwner } from "../../approvals/api/queries.js";
import { listAgentSessionsOverAcp } from "../../sessions/api/acp-session-ops.js";
import { acpSessionsKeys } from "../../sessions/api/queries.js";
import { type FeedItem, toFeedItems } from "../lib/feed-item.js";

const ARTIFACTS_STALE_MS = 30_000;
const SESSIONS_STALE_MS = 5_000;
const SESSIONS_ERROR_RETRY_MS = 15_000;
const SESSIONS_COMPAT_POLL_MS = 15_000;

export const homeKeys = {
  sessions: (agentId: string) =>
    [...acpSessionsKeys.agentLists(agentId), "home"] as const,
};

export interface ArtifactTouched {
  artifactId: string;
  touchedAt: string;
}

export interface SessionArtifacts {
  bySession: ReadonlyMap<string, readonly ArtifactTouched[]>;
}

export function useFeedArtifacts(items: readonly FeedItem[]): SessionArtifacts {
  const wanted = useMemo(() => {
    const byAgent = new Map<string, Set<string>>();
    for (const item of items) {
      if (item.kind !== "unread") continue;
      const sessions = byAgent.get(item.agentId) ?? new Set<string>();
      sessions.add(item.session.sessionId);
      byAgent.set(item.agentId, sessions);
    }
    return [...byAgent].map(([agentId, sessions]) => ({
      agentId,
      sessionIds: [...sessions],
    }));
  }, [items]);

  return useQueries({
    queries: wanted.map(({ agentId, sessionIds }) => ({
      ...trpc.artifactLibrary.touches.queryOptions({ agentId, sessionIds }),
      staleTime: ARTIFACTS_STALE_MS,
      retry: false,
    })),
    combine: (results) => {
      const bySession = new Map<string, ArtifactTouched[]>();
      for (const result of results) {
        for (const touch of result.data ?? []) {
          const seen = bySession.get(touch.sessionId) ?? [];
          if (!seen.some((t) => t.artifactId === touch.artifactId)) {
            seen.push({
              artifactId: touch.artifactId,
              touchedAt: touch.touchedAt,
            });
          }
          bySession.set(touch.sessionId, seen);
        }
      }
      return { bySession };
    },
  });
}

export interface Feed {
  items: FeedItem[];
  agents: readonly AgentView[];
  runningAgents: readonly AgentView[];
  hasAgents: boolean;
  loadingAgents: boolean;
  loadingFeed: boolean;
  unreadableAgents: number;
  approvalsUnreadable: boolean;
}

export function useFeed(): Feed {
  const agents = useAgentsList();
  const agentsQuery = useAgents();
  const approvals = useApprovalsForOwner();

  const runningAgents = useMemo(
    () => agents.filter((agent) => agent.state === "running"),
    [agents],
  );

  const sessions = useQueries({
    queries: runningAgents.map((agent) => ({
      queryKey: homeKeys.sessions(agent.id),
      queryFn: () => listAgentSessionsOverAcp(agent.id),
      staleTime: SESSIONS_STALE_MS,
      retry: false,
      refetchInterval: (query: { state: { status: string } }) =>
        !agent.features.liveUpdates
          ? SESSIONS_COMPAT_POLL_MS
          : query.state.status === "error"
            ? SESSIONS_ERROR_RETRY_MS
            : false,
    })),
    combine: (results) => ({
      byAgent: results.map((result) => result.data ?? []),
      pending: results.some((result) => result.isPending),
      failed: results.filter((result) => result.isError).length,
    }),
  });

  const items = toFeedItems({
    approvals: (approvals.data ?? []).filter((a) => a.status === "pending"),
    byAgent: runningAgents.map((agent, index) => ({
      agentId: agent.id,
      sessions: sessions.byAgent[index] ?? [],
    })),
  });

  return {
    items,
    agents,
    runningAgents,
    hasAgents: agents.length > 0,
    loadingAgents: agentsQuery.isPending,
    loadingFeed: approvals.isPending || sessions.pending,
    unreadableAgents: sessions.failed,
    approvalsUnreadable: approvals.isError,
  };
}
