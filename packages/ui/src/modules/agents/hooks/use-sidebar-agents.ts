import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  type AgentActivitySession,
  useActivitySessions,
} from "../../home/hooks/use-activity-sessions.js";
import { filterActivitySessions } from "../../home/lib/activity-sessions.js";
import { useAgents } from "../api/queries.js";
import {
  groupSessionsByAgent,
  orderByLatestSession,
} from "../lib/sidebar-agent-order.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

const NO_AGENTS: AgentView[] = [];
const NO_SESSIONS: AgentActivitySession[] = [];

export function useSidebarAgents() {
  const list = useAgents().data?.list ?? NO_AGENTS;
  const activity = useActivitySessions();
  const filters = useStore((s) => s.sidebarActivityFilters);
  const openAgentId = useStore((s) =>
    s.view === "chat"
      ? s.selectedAgent
      : s.view === "sandbox-home"
        ? s.agentId
        : null,
  );
  const sessionOpen = useStore((s) => s.view === "chat" && !!s.sessionId);

  const sessionsByAgent = useMemo(
    () => groupSessionsByAgent(filterActivitySessions(activity.items, filters)),
    [activity.items, filters],
  );

  const agents = useMemo(
    () =>
      orderByLatestSession(
        splitTemporarySandboxes(list).visible,
        sessionsByAgent,
      ),
    [list, sessionsByAgent],
  );

  const unreadAgentIds = new Set(
    activity.items
      .filter((item) => item.unread)
      .map((item) => item.session.agentId),
  );

  const sessionsOf = (agentId: string) =>
    sessionsByAgent.get(agentId) ?? NO_SESSIONS;

  return {
    agents,
    openAgentId,
    sessionOpen,
    unreadAgentIds,
    sessionsOf,
    previewComplete: activity.complete,
  };
}
