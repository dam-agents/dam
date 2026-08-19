import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import type { AgentView } from "../../../types.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useApprovalsForOwner } from "../../approvals/api/queries.js";
import { listAgentSessions } from "../../sessions/api/acp-session-ops.js";
import { acpSessionsKeys } from "../../sessions/api/queries.js";
import { type FeedItem, toFeedItems } from "../lib/feed-item.js";

const SESSIONS_POLL_MS = 15_000;
const SESSIONS_STALE_MS = 5_000;

export const homeKeys = {
  sessions: (agentId: string) =>
    [...acpSessionsKeys.agentLists(agentId), "home"] as const,
};

export interface Feed {
  items: FeedItem[];
  runningAgents: readonly AgentView[];
  hasAgents: boolean;
  loadingApprovals: boolean;
}

export function useFeed(): Feed {
  const agents = useAgentsList();
  const approvals = useApprovalsForOwner();

  const runningAgents = useMemo(
    () => agents.filter((agent) => agent.state === "running"),
    [agents],
  );

  const sessions = useQueries({
    queries: runningAgents.map((agent) => ({
      queryKey: homeKeys.sessions(agent.id),
      queryFn: () => listAgentSessions(agent.id),
      refetchInterval: SESSIONS_POLL_MS,
      staleTime: SESSIONS_STALE_MS,
      retry: false,
    })),
    combine: (results) => results.map((result) => result.data ?? []),
  });

  const items = toFeedItems({
    approvals: (approvals.data ?? []).filter((a) => a.status === "pending"),
    byAgent: runningAgents.map((agent, index) => ({
      agentId: agent.id,
      sessions: sessions[index] ?? [],
    })),
  });

  return {
    items,
    runningAgents,
    hasAgents: agents.length > 0,
    loadingApprovals: approvals.isPending,
  };
}
