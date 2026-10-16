import { useMemo, useState } from "react";

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
  leadAgentId,
  openFirst,
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
  const { pins } = useSidebarPins();
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

  const { items: ordered, pinned: pinnedAgentIds } = useMemo(
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
  const [pointerInside, setPointerInside] = useState(false);
  const [shownLead, setShownLead] = useState(openAgentId);
  const lead = leadAgentId(shownLead, openAgentId, pointerInside);
  if (lead !== shownLead) setShownLead(lead);
  const agents = useMemo(() => openFirst(ordered, lead), [ordered, lead]);

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
    leadAgentId: lead,
    holdOrder: setPointerInside,
    sessionOpen,
    unreadAgentIds,
    sessionsOf,
    pinnedSessionsOf,
    previewComplete: activity.complete,
  };
}
