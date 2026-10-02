import { useMemo } from "react";

import { useAgentsList } from "../modules/agents/api/queries.js";
import { resolveAgentDisplay } from "../modules/agents/utils/agent-resolver.js";
import { useStore } from "../store.js";
import { SidebarAgentItem } from "./sidebar-agent-item.js";
import { useSidebarAgentActions } from "./use-sidebar-agent-actions.js";

export function SidebarAgentList() {
  const agents = useAgentsList();
  const restartingAgents = useStore((s) => s.restartingAgents);
  const pausingAgents = useStore((s) => s.pausingAgents);

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const pausingIds = useMemo(
    () => new Set(pausingAgents.keys()),
    [pausingAgents],
  );

  const actions = useSidebarAgentActions();

  if (agents.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">No agents yet</p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {agents.map((agent) => {
        const display = resolveAgentDisplay(agent, restartingIds, pausingIds);
        return (
          <SidebarAgentItem
            key={agent.id}
            agent={agent}
            display={display}
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
