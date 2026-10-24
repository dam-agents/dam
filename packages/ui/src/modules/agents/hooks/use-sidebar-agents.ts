import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  type AgentActivitySession,
  useActivitySessions,
} from "../../home/hooks/use-activity-sessions.js";
import { shownSessionId } from "../../sessions/lib/shown-session.js";
import { useAgents, useSharedAgents } from "../api/queries.js";
import { useSidebarOrder } from "../api/sidebar-order.js";
import {
  groupSessionsByAgent,
  sidebarAgentFolded,
  sidebarAgentOpen,
} from "../lib/sidebar-agent-order.js";
import { manualOrder } from "../lib/sidebar-order.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

const NO_AGENTS: AgentView[] = [];
const NO_SESSIONS: AgentActivitySession[] = [];

export function useSidebarAgents() {
  const list = useAgents().data?.list ?? NO_AGENTS;
  const activity = useActivitySessions();
  const { order } = useSidebarOrder();
  const openAgentId = useStore((s) =>
    s.view === "chat"
      ? s.selectedAgent
      : s.view === "sandbox-home"
        ? s.agentId
        : null,
  );
  const sessionOpen = useStore((s) => s.view === "chat" && !!shownSessionId(s));
  const openOverrides = useStore((s) => s.sidebarAgentOpen);
  const isOpen = (agentId: string) =>
    sidebarAgentOpen(openOverrides, agentId, openAgentId);

  const sessionsByAgent = useMemo(
    () => groupSessionsByAgent(activity.items),
    [activity.items],
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

  const { active, folded } = useMemo(() => {
    const isFolded = (agent: AgentView) =>
      sidebarAgentFolded(openOverrides, agent, openAgentId);
    return {
      active: agents.filter((agent) => !isFolded(agent)),
      folded: agents.filter(isFolded),
    };
  }, [agents, openAgentId, openOverrides]);

  const unreadAgentIds = new Set(
    activity.items
      .filter((item) => item.unread)
      .map((item) => item.session.agentId),
  );

  const sessionsOf = (agentId: string) =>
    sessionsByAgent.get(agentId) ?? NO_SESSIONS;

  return {
    agents,
    active,
    folded,
    openAgentId,
    isOpen,
    sessionOpen,
    unreadAgentIds,
    sessionsOf,
    previewComplete: activity.complete,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agents shared with this person, for the
 * sidebar's Shared with me section. Sorted by name: the owner's manual order
 * belongs to the owner, and an editor does not reorder them. They fold away
 * when asleep, and open to their Sessions, the same way the person's own
 * agents do.
 */
export function useSidebarSharedAgents() {
  const shared = useSharedAgents();
  const openOverrides = useStore((s) => s.sidebarAgentOpen);
  const openAgentId = useStore((s) =>
    s.view === "chat"
      ? s.selectedAgent
      : s.view === "sandbox-home"
        ? s.agentId
        : null,
  );
  const sessionOpen = useStore((s) => s.view === "chat" && !!shownSessionId(s));
  return useMemo(() => {
    const sorted = [...shared].sort((a, b) => a.name.localeCompare(b.name));
    const isFolded = (agent: AgentView) =>
      sidebarAgentFolded(openOverrides, agent, openAgentId);
    return {
      shared: sorted,
      active: sorted.filter((agent) => !isFolded(agent)),
      folded: sorted.filter(isFolded),
      openAgentId,
      sessionOpen,
      isOpen: (agentId: string) =>
        sidebarAgentOpen(openOverrides, agentId, openAgentId),
    };
  }, [shared, openOverrides, openAgentId, sessionOpen]);
}
