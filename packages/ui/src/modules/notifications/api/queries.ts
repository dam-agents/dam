import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import type { AgentView } from "../../../types.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useApprovalsForOwner } from "../../approvals/api/queries.js";
import { isDemoAgentId } from "../../packs/hooks/use-is-demo-agent.js";
import { listAgentSessionsOverAcp } from "../../sessions/api/acp-session-ops.js";
import { acpSessionsKeys } from "../../sessions/api/queries.js";
import { buildNotificationItems } from "../lib/build-items.js";
import type { NotificationItem } from "../lib/notification-types.js";

const SESSIONS_STALE_MS = 5_000;
const SESSIONS_ERROR_RETRY_MS = 15_000;
const SESSIONS_COMPAT_POLL_MS = 15_000;

export const notificationKeys = {
  sessions: (agentId: string) =>
    [...acpSessionsKeys.agentLists(agentId), "notifications"] as const,
};

export interface Notifications {
  items: NotificationItem[];
  agents: readonly AgentView[];
  loading: boolean;
}

export function useNotifications(): Notifications {
  const agents = useAgentsList();
  const approvals = useApprovalsForOwner();

  const runningAgents = useMemo(
    () => agents.filter((agent) => agent.state === "running"),
    [agents],
  );

  const mockFn = (window as any).__mockListAgentSessions;
  const sessions = useQueries({
    queries: runningAgents.map((agent) => ({
      queryKey: notificationKeys.sessions(agent.id),
      queryFn: () =>
        mockFn ? mockFn(agent.id) : listAgentSessionsOverAcp(agent.id),
      staleTime: mockFn ? Infinity : SESSIONS_STALE_MS,
      retry: false,
      refetchInterval: mockFn
        ? false
        : (query: { state: { status: string } }) =>
            !agent.features.liveUpdates
              ? SESSIONS_COMPAT_POLL_MS
              : query.state.status === "error"
                ? SESSIONS_ERROR_RETRY_MS
                : false,
    })),
    combine: (results) => ({
      byAgent: results.map((result) => result.data ?? []),
      pending: results.some((result) => result.isPending),
    }),
  });

  const items = buildNotificationItems({
    approvals: (approvals.data ?? []).filter((a) => a.status === "pending"),
    byAgent: runningAgents.map((agent, index) => ({
      agentId: agent.id,
      sessions: sessions.byAgent[index] ?? [],
    })),
  });

  return {
    items,
    agents: agents.filter((a) => !isDemoAgentId(a.id)),
    loading: approvals.isPending || sessions.pending,
  };
}
