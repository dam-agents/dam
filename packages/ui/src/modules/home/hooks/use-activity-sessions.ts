import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useAttention } from "../api/queries.js";
import {
  type ActivitySession,
  toActivitySessions,
} from "../lib/activity-sessions.js";

export type AgentActivitySession = ActivitySession & { agent: AgentView };

export function useActivitySessions() {
  const attention = useAttention();
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
    return toActivitySessions(attention.data?.items ?? [], running).flatMap(
      (item) => {
        const agent = byId.get(item.session.agentId);
        if (!agent) return [];
        return [
          { ...item, agent, unread: item.unread && item.id !== openSessionKey },
        ];
      },
    );
  }, [attention.data, agents, openSessionKey]);

  return {
    items,
    openSessionKey,
    loading: attention.isPending,
    unreadable: attention.isError,
  };
}
