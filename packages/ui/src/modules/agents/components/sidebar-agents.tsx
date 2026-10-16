import { Add, NewTab, Tools } from "@carbon/icons-react";
import { type ReactNode, useMemo } from "react";

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
import { SidebarAgentRow } from "./sidebar-agent-row.js";

export function SidebarAgents({
  stickyHeaderClassName,
  onNavigate,
}: {
  stickyHeaderClassName: string;
  onNavigate?: () => void;
}) {
  const { agents, openAgentId, unreadAgentIds, sessionsOf } =
    useSidebarAgents();
  const activity = useActivitySessions();
  const allAgents = useAgentsList();
  const attention = useMemo(
    () => activity.items.map((item) => item.session),
    [activity.items],
  );
  const conversationOf = useActivityConversations(attention, allAgents);
  const filters = useStore((s) => s.sidebarActivityFilters);
  const setFilters = useStore((s) => s.setSidebarActivityFilters);
  const selectAgent = useStore((s) => s.selectAgent);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const startSession = useStartSession();

  const navigate = (go: () => void) => () => {
    go();
    onNavigate?.();
  };

  const row = (agent: AgentView) => {
    const open = agent.id === openAgentId;
    return (
      <SidebarAgentRow
        key={agent.id}
        agent={agent}
        selected={open}
        unread={unreadAgentIds.has(agent.id)}
        onSelect={() => {
          if (!open) selectAgent(agent.id);
        }}
        actions={
          <>
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
          conversationOf={conversationOf}
          stickyClassName={stickyHeaderClassName}
          onNavigate={onNavigate}
        />
      </SidebarAgentRow>
    );
  };

  return (
    <section aria-label="Agents" data-testid="sidebar-agents">
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
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
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
        className="flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <Add size={14} />
      </button>
    </Tooltip>
  );
}
