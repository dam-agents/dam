import { useInfiniteQuery } from "@tanstack/react-query";
import {
  type ApprovalView,
  ATTENTION_FEED_LIMIT,
  type AttentionItem,
  type AttentionListCursor,
} from "api-server-api";
import { useMemo } from "react";

import { api } from "../../../api.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useApprovalsForOwner } from "../../approvals/api/queries.js";
import { useAttention } from "../api/queries.js";
import {
  type ActivitySession,
  activitySessionKey,
  toActivitySessions,
} from "../lib/activity-sessions.js";

export type AgentActivitySession = ActivitySession & { agent: AgentView };

const FEED_STALE_MS = 5_000;

function useOpenSessionKey() {
  return useStore((s) =>
    s.view === "chat" && s.selectedAgent && s.sessionId
      ? `${s.selectedAgent}:${s.sessionId}`
      : null,
  );
}

function agentActivitySessions(
  attention: readonly AttentionItem[],
  agents: readonly AgentView[],
  approvals: readonly ApprovalView[],
  openSessionKey: string | null,
): AgentActivitySession[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const running = new Set(
    agents.filter((a) => a.state === "running").map((a) => a.id),
  );
  const waiting = new Set(
    approvals.flatMap((a) =>
      a.status === "pending" && a.sessionId
        ? [activitySessionKey(a.agentId, a.sessionId)]
        : [],
    ),
  );
  return toActivitySessions(attention, running, waiting).flatMap((item) => {
    const agent = byId.get(item.session.agentId);
    if (!agent) return [];
    return [
      { ...item, agent, unread: item.unread && item.id !== openSessionKey },
    ];
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the owner's newest Sessions from the shared attention reply, which Home's cards and the tree's own hints read; it stays the feed's bounded answer, while "All sessions" pages the record through useActivityFeed.
 */
export function useActivitySessions() {
  const attention = useAttention();
  const approvals = useApprovalsForOwner();
  const agents = useAgentsList();
  const openSessionKey = useOpenSessionKey();

  const items = useMemo<AgentActivitySession[]>(
    () =>
      agentActivitySessions(
        attention.data?.items ?? [],
        agents,
        approvals.data ?? [],
        openSessionKey,
      ),
    [attention.data, approvals.data, agents, openSessionKey],
  );

  return {
    items,
    openSessionKey,
    complete:
      attention.isSuccess && attention.data.items.length < ATTENTION_FEED_LIMIT,
    loading: attention.isPending,
    unreadable: attention.isError,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what "All sessions" lists, a page of the owner's attention record at a time, each page starting after the last row the one before it returned so the list reaches every Session the record holds rather than its newest 200; a row is enriched the way the shared reply's rows are, and pages are de-duplicated by Session in case a refetch shifted rows across a page boundary.
 */
export function useActivityFeed(enabled: boolean) {
  const approvals = useApprovalsForOwner();
  const agents = useAgentsList();
  const openSessionKey = useOpenSessionKey();
  const pages = useInfiniteQuery({
    queryKey: trpc.attention.listForOwnerPage.queryKey({}),
    enabled,
    queryFn: ({ pageParam }) =>
      api.attention.listForOwnerPage.query(
        pageParam ? { after: pageParam } : {},
      ),
    initialPageParam: null as AttentionListCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: FEED_STALE_MS,
    meta: { errorToast: "Couldn't load sessions" },
  });

  const items = useMemo<AgentActivitySession[]>(() => {
    const seen = new Set<string>();
    const rows: AttentionItem[] = [];
    for (const page of pages.data?.pages ?? []) {
      for (const item of page.items) {
        const key = activitySessionKey(item.agentId, item.sessionId);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(item);
      }
    }
    return agentActivitySessions(
      rows,
      agents,
      approvals.data ?? [],
      openSessionKey,
    );
  }, [pages.data, agents, approvals.data, openSessionKey]);

  return {
    items,
    openSessionKey,
    loading: pages.isPending,
    failed: pages.isError,
    hasNextPage: pages.hasNextPage,
    isFetchingNextPage: pages.isFetchingNextPage,
    fetchNextPage: pages.fetchNextPage,
  };
}
