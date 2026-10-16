import { AddAlt, NewTab, Pin, PinFilled, Tools } from "@carbon/icons-react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";

import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { ActivityFilterMenu } from "../../home/components/activity-filter-menu.js";
import { useActivityConversations } from "../../home/hooks/use-activity-conversations.js";
import { useActivitySessions } from "../../home/hooks/use-activity-sessions.js";
import { SidebarAgentSessions } from "../../sessions/components/sidebar-agent-sessions.js";
import { useStartSession } from "../../sessions/hooks/use-start-session.js";
import { useAgentsList } from "../api/queries.js";
import { useCreateDefaultAgent } from "../hooks/use-create-default-agent.js";
import { useSidebarAgents } from "../hooks/use-sidebar-agents.js";
import { useSidebarPinActions } from "../hooks/use-sidebar-pin-actions.js";
import { SidebarAgentRow } from "./sidebar-agent-row.js";

export function SidebarAgents({
  stickyHeaderClassName,
  onNavigate,
}: {
  stickyHeaderClassName: string;
  onNavigate?: () => void;
}) {
  const {
    agents,
    pinnedAgentIds,
    openAgentId,
    leadAgentId,
    holdOrder,
    sessionOpen,
    unreadAgentIds,
    sessionsOf,
    pinnedSessionsOf,
    previewComplete,
  } = useSidebarAgents();
  const pinActions = useSidebarPinActions();
  const activity = useActivitySessions();
  const allAgents = useAgentsList();
  const attention = useMemo(
    () => activity.items.map((item) => item.session),
    [activity.items],
  );
  const conversationOf = useActivityConversations(attention, allAgents);
  const filters = useStore((s) => s.sidebarActivityFilters);
  const setFilters = useStore((s) => s.setSidebarActivityFilters);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const startSession = useStartSession();

  const list = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  useEffect(() => {
    if (leadAgentId) list.current?.parentElement?.scrollTo({ top: 0 });
  }, [leadAgentId]);
  const endDrag = () => {
    dragging.current = false;
    document.addEventListener(
      "pointermove",
      (event) =>
        holdOrder(
          event.target instanceof Node &&
            !!list.current?.contains(event.target),
        ),
      { once: true },
    );
  };

  const navigate = (go: () => void) => () => {
    go();
    onNavigate?.();
  };

  const row = (agent: AgentView) => {
    const open = agent.id === openAgentId;
    const pinned = pinnedAgentIds.has(agent.id);
    return (
      <SidebarAgentRow
        key={agent.id}
        agent={agent}
        open={open}
        current={open && !sessionOpen}
        unread={unreadAgentIds.has(agent.id)}
        pinned={pinned}
        onMovePin={pinActions.moveAgent}
        onStepPin={(id, step) => pinActions.stepAgent(id, step, pinnedAgentIds)}
        onSelect={navigate(() => startSession(agent.id))}
        actions={
          <>
            <RowIconButton
              label={pinned ? "Unpin agent" : "Pin agent"}
              disabled={!pinActions.ready}
              onClick={() => pinActions.toggleAgent(agent.id)}
            >
              {pinned ? <PinFilled size={14} /> : <Pin size={14} />}
            </RowIconButton>
            <RowIconButton
              label="New session"
              onClick={navigate(() => startSession(agent.id))}
            >
              <NewTab size={14} />
            </RowIconButton>
            <RowIconButton
              label="Configure agent"
              onClick={navigate(() => navigateToSandboxHome(agent.id))}
            >
              <Tools size={14} />
            </RowIconButton>
          </>
        }
      >
        <SidebarAgentSessions
          agentId={agent.id}
          open={open}
          preview={sessionsOf(agent.id)}
          previewComplete={previewComplete}
          pins={pinnedSessionsOf(agent.id)}
          pinActions={pinActions}
          conversationOf={conversationOf}
          stickyClassName={stickyHeaderClassName}
          onNavigate={onNavigate}
        />
      </SidebarAgentRow>
    );
  };

  return (
    <section
      ref={list}
      aria-label="Agents"
      data-testid="sidebar-agents"
      onPointerEnter={() => holdOrder(true)}
      onPointerLeave={() => {
        if (!dragging.current) holdOrder(false);
      }}
      onDragStartCapture={() => {
        dragging.current = true;
        holdOrder(true);
      }}
      onDragEndCapture={endDrag}
    >
      <div
        className={cn(
          "sticky top-0 z-raised flex items-center justify-between py-1 pl-2.5",
          stickyHeaderClassName,
        )}
      >
        <SectionLabel>Agents</SectionLabel>
        <div className="flex items-center gap-1">
          <ActivityFilterMenu filters={filters} onChange={setFilters} />
          <CreateAgentButton onCreate={onNavigate} />
        </div>
      </div>
      {activity.unreadable && (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
          Recent sessions can't be loaded right now.
        </p>
      )}
      <ul className="flex flex-col gap-px">{agents.map(row)}</ul>
    </section>
  );
}

function RowIconButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function CreateAgentButton({ onCreate }: { onCreate?: () => void }) {
  const defaultAgent = useCreateDefaultAgent();
  return (
    <Tooltip content="Create agent" side="right">
      <button
        type="button"
        aria-label="Create agent"
        disabled={!defaultAgent.ready}
        onClick={() => {
          void defaultAgent.create();
          onCreate?.();
        }}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <AddAlt size={16} />
      </button>
    </Tooltip>
  );
}
