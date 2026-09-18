import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";
import {
  useAgentLacksLiveUpdates,
  useAgents,
  useAgentsList,
} from "../../agents/api/queries.js";
import { useApprovalsForOwner } from "../../approvals/api/queries.js";
import { listAgentSessionsOverAcp } from "../../sessions/api/acp-session-ops.js";
import { acpSessionsKeys } from "../../sessions/api/queries.js";
import { type FeedItem, toFeedItems } from "../lib/feed-item.js";

const ARTIFACTS_STALE_MS = 30_000;
const TOUCH_SESSIONS_MAX = 50;
const ATTENTION_STALE_MS = 5_000;
const SESSIONS_STALE_MS = 5_000;
const SESSIONS_ERROR_RETRY_MS = 15_000;
const SESSIONS_COMPAT_POLL_MS = 15_000;

export const homeKeys = {
  sessions: (agentId: string) =>
    [...acpSessionsKeys.agentLists(agentId), "home"] as const,
};

function agentSessionsQuery(agentId: string, compat: boolean) {
  return {
    queryKey: homeKeys.sessions(agentId),
    queryFn: () => listAgentSessionsOverAcp(agentId),
    staleTime: SESSIONS_STALE_MS,
    retry: false,
    refetchInterval: (query: { state: { status: string } }) =>
      compat
        ? SESSIONS_COMPAT_POLL_MS
        : query.state.status === "error"
          ? SESSIONS_ERROR_RETRY_MS
          : false,
  };
}

export function useAgentWorking(
  agentId: string,
  enabled: boolean,
): boolean | undefined {
  const compat = useAgentLacksLiveUpdates(agentId);
  const { data } = useQuery({
    ...agentSessionsQuery(agentId, compat),
    enabled,
  });
  return data?.some((session) => session.running);
}

export interface ArtifactTouched {
  artifactId: string;
  touchedAt: string;
  fileName: string;
}

export interface SessionArtifacts {
  bySession: ReadonlyMap<string, readonly ArtifactTouched[]>;
}

export function useFeedArtifacts(items: readonly FeedItem[]): SessionArtifacts {
  const wanted = useMemo(() => {
    const byAgent = new Map<string, string[]>();
    for (const item of items) {
      if (item.kind !== "unread") continue;
      const sessions = byAgent.get(item.agentId) ?? [];
      if (!sessions.includes(item.session.sessionId)) {
        sessions.push(item.session.sessionId);
      }
      byAgent.set(item.agentId, sessions);
    }
    return [...byAgent].map(([agentId, sessions]) => ({
      agentId,
      sessionIds: sessions.slice(0, TOUCH_SESSIONS_MAX),
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
              fileName: touch.fileName,
            });
          }
          bySession.set(touch.sessionId, seen);
        }
      }
      return { bySession };
    },
  });
}

export function useAttention() {
  return useQuery({
    ...trpc.attention.listForOwner.queryOptions(),
    staleTime: ATTENTION_STALE_MS,
  });
}

export interface Feed {
  items: FeedItem[];
  workingAgentIds: ReadonlySet<string>;
  /** UNIT_BOUNDARY_DESCRIPTION: absent until the attention record has loaded. */
  workingByAgent: ReadonlyMap<string, boolean>;
  agents: readonly AgentView[];
  runningAgents: readonly AgentView[];
  hasAgents: boolean;
  loadingAgents: boolean;
  loadingFeed: boolean;
  feedUnreadable: boolean;
  approvalsUnreadable: boolean;
}

export function useFeed(): Feed {
  const agents = useAgentsList();
  const agentsQuery = useAgents();
  const approvals = useApprovalsForOwner();
  const attention = useAttention();

  const runningAgents = useMemo(
    () => agents.filter((agent) => agent.state === "running"),
    [agents],
  );
  const runningAgentIds = useMemo(
    () => new Set(runningAgents.map((agent) => agent.id)),
    [runningAgents],
  );

  const items = toFeedItems({
    approvals: (approvals.data ?? []).filter((a) => a.status === "pending"),
    attention: attention.data?.items ?? [],
    runningAgentIds,
  });

  const workingAgentIds = new Set(
    items.filter((i) => i.kind === "in-progress").map((i) => i.agentId),
  );

  return {
    items,
    workingAgentIds,
    workingByAgent: new Map(
      attention.data
        ? runningAgents.map(
            (agent) => [agent.id, workingAgentIds.has(agent.id)] as const,
          )
        : [],
    ),
    agents,
    runningAgents,
    hasAgents: agents.length > 0,
    loadingAgents: agentsQuery.isPending,
    loadingFeed: approvals.isPending || attention.isPending,
    feedUnreadable: attention.isError,
    approvalsUnreadable: approvals.isError,
  };
}
