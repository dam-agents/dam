import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import type { AgentView } from "../../../types.js";
import { useAgents, useAgentsList } from "../../agents/api/queries.js";
import { useApprovalsForOwner } from "../../approvals/api/queries.js";
import { listAgentSessionsOverAcp } from "../../sessions/api/acp-session-ops.js";
import { acpSessionsKeys } from "../../sessions/api/queries.js";
import { type FeedItem, toFeedItems } from "../lib/feed-item.js";

const SESSIONS_STALE_MS = 5_000;

export const homeKeys = {
  sessions: (agentId: string) =>
    [...acpSessionsKeys.agentLists(agentId), "home"] as const,
};

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
