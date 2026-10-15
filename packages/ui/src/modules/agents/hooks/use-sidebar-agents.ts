import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentState, AgentView } from "../../../types.js";
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

const FOLDED_STATES: ReadonlySet<AgentState> = new Set([
  "hibernating",
  "hibernated",
]);

const NO_AGENTS: AgentView[] = [];
const NO_SESSIONS: AgentActivitySession[] = [];

export function useSidebarAgents() {
  const list = useAgents().data?.list ?? NO_AGENTS;
  const activity = useActivitySessions();
  const filters = useStore((s) => s.sidebarActivityFilters);
  const openAgentId = useStore((s) =>
    s.view === "chat" ? s.selectedAgent : null,
  );

  const sessionsByAgent = useMemo(
    () => groupSessionsByAgent(filterActivitySessions(activity.items, filters)),
    [activity.items, filters],
  );

  const { active, folded } = useMemo(() => {
    const { visible } = splitTemporarySandboxes(list);
    const ordered = orderByLatestSession(visible, sessionsByAgent);
    const isFolded = (agent: AgentView) =>
      agent.id !== openAgentId && FOLDED_STATES.has(agent.state);
    return {
      active: ordered.filter((agent) => !isFolded(agent)),
      folded: ordered.filter(isFolded),
    };
  }, [list, openAgentId, sessionsByAgent]);

  const unreadAgentIds = new Set(
    activity.items
      .filter((item) => item.unread)
      .map((item) => item.session.agentId),
  );

  const sessionsOf = (agentId: string) =>
    sessionsByAgent.get(agentId) ?? NO_SESSIONS;

  return { active, folded, openAgentId, unreadAgentIds, sessionsOf };
}
