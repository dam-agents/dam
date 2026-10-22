import { ATTENTION_FEED_LIMIT } from "api-server-api";
import { useMemo } from "react";

import { useStore } from "../../../store.js";
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

export function useActivitySessions() {
  const attention = useAttention();
  const approvals = useApprovalsForOwner();
  const agents = useAgentsList();
  const openSessionKey = useStore((s) =>
    s.view === "chat" && s.selectedAgent && s.sessionId
      ? `${s.selectedAgent}:${s.sessionId}`
      : null,
  );

  const items = useMemo<AgentActivitySession[]>(() => {
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    const running = new Set(
      agents.filter((a) => a.state === "running").map((a) => a.id),
    );
    const waiting = new Set(
      (approvals.data ?? []).flatMap((a) =>
        a.status === "pending" && a.sessionId
          ? [activitySessionKey(a.agentId, a.sessionId)]
          : [],
      ),
    );
    return toActivitySessions(
      attention.data?.items ?? [],
      running,
      waiting,
    ).flatMap((item) => {
      const agent = byId.get(item.session.agentId);
      if (!agent) return [];
      return [
        { ...item, agent, unread: item.unread && item.id !== openSessionKey },
      ];
    });
  }, [attention.data, approvals.data, agents, openSessionKey]);

  return {
    items,
    openSessionKey,
    complete:
      attention.isSuccess && attention.data.items.length < ATTENTION_FEED_LIMIT,
    loading: attention.isPending,
    unreadable: attention.isError,
  };
}
