import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  type AgentActivitySession,
  useActivitySessions,
} from "../../home/hooks/use-activity-sessions.js";
import { filterActivitySessions } from "../../home/lib/activity-sessions.js";
import { useAgents } from "../api/queries.js";
import { useSidebarPins } from "../api/sidebar-pins.js";
import {
  groupSessionsByAgent,
  orderByLatestSession,
} from "../lib/sidebar-agent-order.js";
import { pinnedFirst } from "../lib/sidebar-pins.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

const NO_AGENTS: AgentView[] = [];
const NO_SESSIONS: AgentActivitySession[] = [];
const NO_PINS: string[] = [];

export function useSidebarAgents() {
  const list = useAgents().data?.list ?? NO_AGENTS;
  const activity = useActivitySessions();
  const pins = useSidebarPins();
  const filters = useStore((s) => s.sidebarActivityFilters);
  const openAgentId = useStore((s) =>
    s.view === "chat" ? s.selectedAgent : null,
  );

  const sessionsByAgent = useMemo(
    () => groupSessionsByAgent(filterActivitySessions(activity.items, filters)),
    [activity.items, filters],
  );

  const { items: agents, pinned: pinnedAgentIds } = useMemo(
    () =>
      pinnedFirst(
        orderByLatestSession(
          splitTemporarySandboxes(list).visible,
          sessionsByAgent,
        ),
        pins.agents,
        (agent) => agent.id,
      ),
    [list, sessionsByAgent, pins.agents],
  );

  const unreadAgentIds = new Set(
    activity.items
      .filter((item) => item.unread)
      .map((item) => item.session.agentId),
  );

  const sessionsOf = (agentId: string) =>
    sessionsByAgent.get(agentId) ?? NO_SESSIONS;

  const pinnedSessionsOf = (agentId: string) =>
    pins.sessions[agentId] ?? NO_PINS;

  return {
    agents,
    pinnedAgentIds,
    openAgentId,
    unreadAgentIds,
    sessionsOf,
    pinnedSessionsOf,
  };
}
