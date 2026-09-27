import { useMemo } from "react";

import { useAgentsList } from "../modules/agents/api/queries.js";
import { resolveAgentDisplay } from "../modules/agents/utils/agent-resolver.js";
import { useOwnerSchedules } from "../modules/schedules/api/queries.js";
import { useStore } from "../store.js";
import { SidebarAgentItem } from "./sidebar-agent-item.js";
import { useSidebarAgentActions } from "./use-sidebar-agent-actions.js";

export function SidebarAgentList() {
  const agents = useAgentsList();
  const restartingAgents = useStore((s) => s.restartingAgents);
  const pausingAgents = useStore((s) => s.pausingAgents);
  const { data: ownerSchedules } = useOwnerSchedules();

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const pausingIds = useMemo(
    () => new Set(pausingAgents.keys()),
    [pausingAgents],
  );

  const scheduleCountByAgent = useMemo(() => {
    if (!ownerSchedules) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const s of ownerSchedules) {
      counts.set(s.agentId, (counts.get(s.agentId) ?? 0) + 1);
    }
    return counts;
  }, [ownerSchedules]);

  const actions = useSidebarAgentActions();

  if (agents.length === 0) {
    return (
      <p className="px-2.5 py-2 text-sm text-muted-foreground">No agents yet</p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {agents.map((agent) => {
        const display = resolveAgentDisplay(agent, restartingIds, pausingIds);
        return (
          <SidebarAgentItem
            key={agent.id}
            agent={agent}
            display={display}
            scheduleCount={scheduleCountByAgent.get(agent.id) ?? 0}
            deletePending={actions.isDeletePending(agent.id)}
            onConfigure={() => actions.onConfigure(agent)}
            onWake={() => actions.onWake(agent)}
            onRestart={() => actions.onRestart(agent)}
            onPause={() => actions.onPause(agent)}
            onStop={() => actions.onStop(agent)}
            onDelete={() => actions.onDelete(agent)}
          />
        );
      })}
    </div>
  );
}
