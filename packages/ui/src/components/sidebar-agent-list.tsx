import { ChevronLeft, ChevronRight } from "@carbon/icons-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";

import { useAgentsList } from "../modules/agents/api/queries.js";
import type { AgentDisplayState } from "../modules/agents/utils/agent-resolver.js";
import { resolveAgentDisplay } from "../modules/agents/utils/agent-resolver.js";
import { SIDEBAR_DESIGN_VARIANT_COUNT } from "../modules/platform/store/sidebar-agents.js";
import { useOwnerSchedules } from "../modules/schedules/api/queries.js";
import { useStore } from "../store.js";
import { SidebarAgentItem } from "./sidebar-agent-item.js";
import { useSidebarAgentActions } from "./use-sidebar-agent-actions.js";

export type SidebarGroup = "working" | "idle" | "hibernating";

const GROUP_FOR_STATE: Record<AgentDisplayState, SidebarGroup> = {
  running: "working",
  running_always_on: "working",
  starting: "working",
  preparing_workspace: "working",
  hibernated: "idle",
  idle_always_on: "idle",
  hibernating: "hibernating",
  error: "idle",
  over_budget: "idle",
};

const GROUP_ORDER: SidebarGroup[] = ["working", "idle", "hibernating"];

const GROUP_LABEL: Record<SidebarGroup, string> = {
  working: "Working",
  idle: "Idle",
  hibernating: "Hibernating",
};

export function SidebarAgentList() {
  const agents = useAgentsList();
  const restartingAgents = useStore((s) => s.restartingAgents);
  const pausingAgents = useStore((s) => s.pausingAgents);
  const { data: ownerSchedules } = useOwnerSchedules();
  const variant = useStore((s) => s.sidebarDesignVariant);
  const cycle = useStore((s) => s.cycleSidebarDesign);

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

  const grouped = useMemo(() => {
    const buckets: Record<SidebarGroup, typeof agents> = {
      working: [],
      idle: [],
      hibernating: [],
    };
    for (const agent of agents) {
      const display = resolveAgentDisplay(agent, restartingIds, pausingIds);
      const group = GROUP_FOR_STATE[display.state] ?? "idle";
      buckets[group].push(agent);
    }
    return buckets;
  }, [agents, restartingIds, pausingIds]);

  if (agents.length === 0) {
    return (
      <p className="px-2.5 py-2 text-sm text-muted-foreground">No agents yet</p>
    );
  }

  const groupGap = [2, 4, 6, 7, 8, 9, 10].includes(variant)
    ? "gap-5"
    : variant === 3
      ? "gap-2"
      : "gap-4";

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 pb-3">
        <span className="text-xs font-medium text-muted-foreground">
          Design {variant}/{SIDEBAR_DESIGN_VARIANT_COUNT}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => cycle(-1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => cycle(1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <div className={`flex flex-col ${groupGap}`}>
        {GROUP_ORDER.map((group) => {
          const items = grouped[group];
          if (items.length === 0) return null;

          const itemGap =
            variant === 3
              ? "gap-0"
              : variant === 2
                ? "gap-2"
                : [4, 6, 7, 10].includes(variant)
                  ? "gap-1.5"
                  : "gap-1";

          return (
            <div key={group}>
              <GroupHeader
                variant={variant}
                group={group}
                count={items.length}
              />
              <div className={`flex flex-col ${itemGap}`}>
                {items.map((agent) => {
                  const display = resolveAgentDisplay(
                    agent,
                    restartingIds,
                    pausingIds,
                  );
                  return (
                    <SidebarAgentItem
                      key={agent.id}
                      agent={agent}
                      display={display}
                      group={group}
                      variant={variant}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GroupHeader({
  variant,
  group,
  count,
}: {
  variant: number;
  group: SidebarGroup;
  count: number;
}) {
  if (variant === 5) return null;

  if (variant === 8) {
    return (
      <div className="mb-2 flex items-center gap-2 px-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {GROUP_LABEL[group]}
        </span>
        <span className="text-xs text-muted-foreground/60">{count}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }

  if (variant === 9) {
    return (
      <div className="mb-1.5 px-4">
        <span className="text-[14px] font-semibold text-foreground/80">
          {GROUP_LABEL[group]}
        </span>
      </div>
    );
  }

  if (variant === 10) {
    return (
      <div className="mb-3 px-5">
        <span className="text-sm font-semibold text-foreground">
          {GROUP_LABEL[group]}
        </span>
      </div>
    );
  }

  const headerPx = [4, 6, 7].includes(variant) ? "px-5" : "px-4";
  const headerMb = [4, 7].includes(variant) ? "mb-2" : "mb-1";

  return (
    <div
      className={`${headerMb} ${headerPx} text-xs font-medium uppercase tracking-wider text-muted-foreground`}
    >
      {GROUP_LABEL[group]}
    </div>
  );
}
