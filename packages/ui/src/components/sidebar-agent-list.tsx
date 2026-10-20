import { useCallback, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useAgentsList } from "../modules/agents/api/queries.js";
import { resolveAgentDisplay } from "../modules/agents/utils/agent-resolver.js";
import { useStore } from "../store.js";
import type { AgentView } from "../types.js";
import { SidebarAgentItem } from "./sidebar-agent-item.js";
import { useSidebarAgentActions } from "./use-sidebar-agent-actions.js";

function applyOrder(
  agents: readonly AgentView[],
  order: string[],
): AgentView[] {
  if (order.length === 0) return [...agents];
  const byId = new Map(agents.map((a) => [a.id, a]));
  const ordered: AgentView[] = [];
  for (const id of order) {
    const agent = byId.get(id);
    if (agent) {
      ordered.push(agent);
      byId.delete(id);
    }
  }
  for (const agent of byId.values()) {
    ordered.push(agent);
  }
  return ordered;
}

export function SidebarAgentList() {
  const agents = useAgentsList();
  const restartingAgents = useStore((s) => s.restartingAgents);
  const pausingAgents = useStore((s) => s.pausingAgents);
  const agentOrder = useStore((s) => s.sidebarAgentOrder);
  const reorder = useStore((s) => s.reorderSidebarAgents);

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const pausingIds = useMemo(
    () => new Set(pausingAgents.keys()),
    [pausingAgents],
  );

  const orderedAgents = useMemo(
    () => applyOrder(agents, agentOrder),
    [agents, agentOrder],
  );

  const actions = useSidebarAgentActions();

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<"above" | "below" | null>(
    null,
  );
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleDragStart = useCallback(
    (e: React.DragEvent, agentId: string) => {
      setDraggedId(agentId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", agentId);
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.style.opacity = "0.5";
      }
    },
    [],
  );

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "";
    }
    setDraggedId(null);
    setDropTargetId(null);
    setDropPosition(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, agentId: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (agentId === draggedId) {
        setDropTargetId(null);
        setDropPosition(null);
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const pos = e.clientY < midY ? "above" : "below";
      setDropTargetId(agentId);
      setDropPosition(pos);
    },
    [draggedId],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      if (!draggedId || draggedId === targetId) return;

      const currentOrder = orderedAgents.map((a) => a.id);
      const fromIndex = currentOrder.indexOf(draggedId);
      if (fromIndex === -1) return;

      const newOrder = currentOrder.filter((id) => id !== draggedId);
      let toIndex = newOrder.indexOf(targetId);
      if (toIndex === -1) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY >= midY) toIndex += 1;

      newOrder.splice(toIndex, 0, draggedId);
      reorder(newOrder);
      setDraggedId(null);
      setDropTargetId(null);
      setDropPosition(null);
    },
    [draggedId, orderedAgents, reorder],
  );

  if (agents.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">No agents yet</p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {orderedAgents.map((agent) => {
        const display = resolveAgentDisplay(agent, restartingIds, pausingIds);
        const isDropTarget = dropTargetId === agent.id && draggedId !== null;
        return (
          <div
            key={agent.id}
            ref={(el) => {
              if (el) rowRefs.current.set(agent.id, el);
              else rowRefs.current.delete(agent.id);
            }}
            draggable
            onDragStart={(e) => handleDragStart(e, agent.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, agent.id)}
            onDrop={(e) => handleDrop(e, agent.id)}
            className={cn(
              "relative transition-[border-color]",
              isDropTarget &&
                dropPosition === "above" &&
                "before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:rounded-full before:bg-primary",
              isDropTarget &&
                dropPosition === "below" &&
                "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary",
            )}
          >
            <SidebarAgentItem
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
          </div>
        );
      })}
    </div>
  );
}
