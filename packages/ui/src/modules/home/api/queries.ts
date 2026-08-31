import { useQueries } from "@tanstack/react-query";
import type { ApprovalView } from "api-server-api";
import { useMemo } from "react";

import type { AgentView } from "../../../types.js";
import { useAgents, useAgentsList } from "../../agents/api/queries.js";
import { useApprovalsForOwner } from "../../approvals/api/queries.js";
import { listAgentSessions } from "../../sessions/api/acp-session-ops.js";
import { acpSessionsKeys } from "../../sessions/api/queries.js";
import { type FeedItem, toFeedItems } from "../lib/feed-item.js";

const SESSIONS_STALE_MS = 5_000;
const SESSIONS_ERROR_RETRY_MS = 15_000;
const SESSIONS_COMPAT_POLL_MS = 15_000;

export const homeKeys = {
  sessions: (agentId: string) =>
    [...acpSessionsKeys.agentLists(agentId), "home"] as const,
};

export interface Feed {
  items: FeedItem[];
  approvals: readonly ApprovalView[];
  pendingApprovals: readonly ApprovalView[];
  agents: readonly AgentView[];
  runningAgents: readonly AgentView[];
  hasAgents: boolean;
  loadingAgents: boolean;
  loadingFeed: boolean;
  unreadableAgents: number;
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
      queryFn: () => listAgentSessions(agent.id),
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

  const allApprovals = approvals.data ?? [];
  const pendingApprovals = allApprovals.filter((a) => a.status === "pending");

  const items = toFeedItems({
    byAgent: runningAgents.map((agent, index) => ({
      agentId: agent.id,
      sessions: sessions.byAgent[index] ?? [],
    })),
  });

  return {
    items,
    approvals: allApprovals,
    pendingApprovals,
    agents,
    runningAgents,
    hasAgents: agents.length > 0,
    loadingAgents: agentsQuery.isPending,
    loadingFeed: approvals.isPending || sessions.pending,
    unreadableAgents: sessions.failed,
  };
}
