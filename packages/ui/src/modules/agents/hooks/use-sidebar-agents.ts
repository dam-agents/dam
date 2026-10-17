import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  type AgentActivitySession,
  useActivitySessions,
} from "../../home/hooks/use-activity-sessions.js";
import { filterActivitySessions } from "../../home/lib/activity-sessions.js";
import { shownSessionId } from "../../sessions/lib/shown-session.js";
import { useAgents } from "../api/queries.js";
import { useSidebarOrder } from "../api/sidebar-order.js";
import { groupSessionsByAgent } from "../lib/sidebar-agent-order.js";
import { manualOrder } from "../lib/sidebar-order.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

const NO_AGENTS: AgentView[] = [];
const NO_SESSIONS: AgentActivitySession[] = [];

export function useSidebarAgents() {
  const list = useAgents().data?.list ?? NO_AGENTS;
  const activity = useActivitySessions();
  const { order } = useSidebarOrder();
  const filters = useStore((s) => s.sidebarActivityFilters);
  const openAgentId = useStore((s) =>
    s.view === "chat"
      ? s.selectedAgent
      : s.view === "sandbox-home"
        ? s.agentId
        : null,
  );
  const sessionOpen = useStore((s) => s.view === "chat" && !!shownSessionId(s));

  const sessionsByAgent = useMemo(
    () => groupSessionsByAgent(filterActivitySessions(activity.items, filters)),
    [activity.items, filters],
  );

  const agents = useMemo(
    () =>
      manualOrder(
        splitTemporarySandboxes(list).visible,
        order.agents,
        (agent) => agent.id,
        (agent) => agent.createdAt,
      ),
    [list, order.agents],
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
