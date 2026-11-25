import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useActivitySessions } from "../../home/hooks/use-activity-sessions.js";
import { useAgents, useSharedAgents } from "../api/queries.js";
import { useSidebarOrder } from "../api/sidebar-order.js";
import { sidebarAgentFolded } from "../lib/sidebar-agent-order.js";
import { manualOrder } from "../lib/sidebar-order.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

const NO_AGENTS: AgentView[] = [];

function useShownAgentId() {
  return useStore((s) => (s.view === "chat" ? s.selectedAgent : null));
}

export function useSidebarAgents() {
  const list = useAgents().data?.list ?? NO_AGENTS;
  const activity = useActivitySessions();
  const { order } = useSidebarOrder();
  const openAgentId = useShownAgentId();
  const sidebarAgent = useStore((s) => s.sidebarAgent);
  const lastAgent = useStore((s) => s.sidebarLastAgent);

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
      sidebarAgentFolded(agent, openAgentId, lastAgent);
    return {
      active: agents.filter((agent) => !isFolded(agent)),
      folded: agents.filter(isFolded),
    };
  }, [agents, openAgentId, lastAgent]);

  const unreadAgentIds = new Set(
    activity.items
      .filter((item) => item.unread)
      .map((item) => item.session.agentId),
  );

  return {
    agents,
    active,
    folded,
    openAgentId,
    sidebarAgent,
    unreadAgentIds,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agents shared with this person, for the
 * sidebar's Shared with me section. Sorted by name: the owner's manual order
 * belongs to the owner, and an editor does not reorder them. They fold away
 * when asleep, and open to their agent view, the same way the person's own
 * agents do.
 */
export function useSidebarSharedAgents() {
  const shared = useSharedAgents();
  const openAgentId = useShownAgentId();
  const sidebarAgent = useStore((s) => s.sidebarAgent);
  const lastAgent = useStore((s) => s.sidebarLastAgent);
  return useMemo(() => {
    const sorted = [...shared].sort((a, b) => a.name.localeCompare(b.name));
    const isFolded = (agent: AgentView) =>
      sidebarAgentFolded(agent, openAgentId, lastAgent);
    return {
      shared: sorted,
      active: sorted.filter((agent) => !isFolded(agent)),
      folded: sorted.filter(isFolded),
      openAgentId,
      sidebarAgent,
    };
  }, [shared, openAgentId, sidebarAgent, lastAgent]);
}
