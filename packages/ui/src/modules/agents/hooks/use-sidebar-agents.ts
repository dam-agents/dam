import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentState, AgentView } from "../../../types.js";
import { useFeed } from "../../home/api/queries.js";
import { useActivitySessions } from "../../home/hooks/use-activity-sessions.js";
import { useAgents } from "../api/queries.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

const FOLDED_STATES: ReadonlySet<AgentState> = new Set([
  "hibernating",
  "hibernated",
]);

const NO_AGENTS: AgentView[] = [];

export function useSidebarAgents() {
  const list = useAgents().data?.list ?? NO_AGENTS;
  const { workingByAgent } = useFeed();
  const activity = useActivitySessions();
  const openAgentId = useStore((s) =>
    s.view === "chat" ? s.selectedAgent : null,
  );

  const { active, folded } = useMemo(() => {
    const { visible } = splitTemporarySandboxes(list);
    const isFolded = (agent: AgentView) =>
      agent.id !== openAgentId && FOLDED_STATES.has(agent.state);
    return {
      active: visible.filter((agent) => !isFolded(agent)),
      folded: visible.filter(isFolded),
    };
  }, [list, openAgentId]);

  const unreadAgentIds = new Set(
    activity.items
      .filter((item) => item.unread)
      .map((item) => item.session.agentId),
  );

  return { active, folded, openAgentId, unreadAgentIds, workingByAgent };
}
