import { Add } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { SidebarEnvironments } from "../../environments/components/sidebar-environments.js";
import { ActivityFilterMenu } from "../../home/components/activity-filter-menu.js";
import { useActivityConversations } from "../../home/hooks/use-activity-conversations.js";
import { useActivitySessions } from "../../home/hooks/use-activity-sessions.js";
import { defaultActivityFilters } from "../../home/lib/activity-filter.js";
import { MessengerBindDialog } from "../../sandboxes/components/channels/messenger-bind-dialog.js";
import type { BindMessenger } from "../../sandboxes/components/channels/messenger-instructions.js";
import { useAgentsWithUnreadListedSessions } from "../../sessions/api/queries.js";
import { SidebarAgentSessions } from "../../sessions/components/sidebar-agent-sessions.js";
import { useStartSession } from "../../sessions/hooks/use-start-session.js";
import {
  setAgentSessionFilter,
  useAgentSessionFilters,
} from "../../sessions/lib/agent-session-filters.js";
import { shownSessionId } from "../../sessions/lib/shown-session.js";
import { useAgents, useAgentsList } from "../api/queries.js";
import { useCreateDefaultAgent } from "../hooks/use-create-default-agent.js";
import { useSidebarAgents } from "../hooks/use-sidebar-agents.js";
import { useSidebarOrderActions } from "../hooks/use-sidebar-order-actions.js";
import {
  hasChannelActions,
  SidebarAgentActions,
} from "./sidebar-agent-actions.js";
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
    active,
    folded,
    openAgentId,
    isOpen,
    sessionOpen,
    unreadAgentIds,
    sessionsOf,
    previewComplete,
  } = useSidebarAgents();
  const orderActions = useSidebarOrderActions();
  const activity = useActivitySessions();
  const allAgents = useAgentsList();
  const attention = useMemo(
    () => activity.items.map((item) => item.session),
    [activity.items],
  );
  const conversationOf = useActivityConversations(attention, allAgents);
  const available = useAgents().data?.availableChannels ?? {};
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setAgentOpen = useStore((s) => s.setSidebarAgentOpen);
  const showFolded = useStore((s) => s.sidebarShowHibernating);
  const setShowFolded = useStore((s) => s.setSidebarShowHibernating);
  const startSession = useStartSession();
  const listedUnread = useAgentsWithUnreadListedSessions(
    useStore(shownSessionId),
  );
  const [binding, setBinding] = useState<BindMessenger | null>(null);
  const agentFilters = useAgentSessionFilters();

  const navigate = (go: () => void) => () => {
    go();
    onNavigate?.();
  };

  const shownAgents = showFolded ? agents : active;
  const shownAgentIds = shownAgents.map((agent) => agent.id);
  const row = (agent: AgentView) => {
    const current = agent.id === openAgentId;
    const open = isOpen(agent.id);
    return (
      <SidebarAgentRow
        key={agent.id}
        agent={agent}
        open={open}
        selected={current && open}
        current={current && !sessionOpen}
        unread={unreadAgentIds.has(agent.id) || listedUnread.has(agent.id)}
        orderReady={orderActions.ready}
        onMove={(id, drop) => orderActions.moveAgent(shownAgentIds, id, drop)}
        onStep={(id, step) => orderActions.stepAgent(shownAgentIds, id, step)}
        onSelect={() => setAgentOpen(agent.id, !open)}
        actionCount={hasChannelActions(available) ? 4 : 3}
        filtered={agentFilters.has(agent.id)}
        filter={
          <ActivityFilterMenu
            filters={agentFilters.get(agent.id) ?? defaultActivityFilters()}
            onChange={(next) => setAgentSessionFilter(agent.id, next)}
            name={`Filter sessions of ${agent.name}`}
            testId="sidebar-agent-session-filter"
            className={cn("hover:bg-background", FOCUS_RING)}
            stopPropagation
          />
        }
        actions={
          <SidebarAgentActions
            agent={agent}
            current={current && !sessionOpen}
            channels={available}
            onNewSession={navigate(() => startSession(agent.id))}
            onConfigure={navigate(() => navigateToSandboxHome(agent.id))}
            onNavigate={navigate(() => undefined)}
            onBind={setBinding}
          />
        }
      >
        {open && (
          <SidebarEnvironments
            agentId={agent.id}
            indent="pl-12"
            onNavigate={onNavigate}
          />
        )}
        {open && (
          <SidebarAgentSessions
            agentId={agent.id}
            open={current}
            preview={sessionsOf(agent.id)}
            previewComplete={previewComplete}
            conversationOf={conversationOf}
            onNavigate={onNavigate}
          />
        )}
      </SidebarAgentRow>
    );
  };

  return (
    <section aria-label="Agents" data-testid="sidebar-agents">
      <div
        className={cn(
          "sticky top-0 z-raised mb-1.5 flex items-center justify-between pt-3 pr-1 pb-1 pl-3",
          stickyHeaderClassName,
        )}
      >
        <SectionLabel>Agents</SectionLabel>
        <CreateAgentButton onCreate={onNavigate} />
      </div>
      {activity.unreadable && (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
          Recent sessions can't be loaded right now.
        </p>
      )}
      <ul className="flex flex-col gap-px">{shownAgents.map(row)}</ul>
      {folded.length > 0 && (
        <button
          type="button"
          onClick={() => setShowFolded(!showFolded)}
          aria-expanded={showFolded}
          data-testid="sidebar-agents-hibernating"
          className="mt-px flex h-[30px] w-full items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {showFolded ? "Show less" : `See all (${folded.length} hibernating)`}
        </button>
      )}
      {binding && (
        <MessengerBindDialog
          messenger={binding}
          onClose={() => setBinding(null)}
        />
      )}
    </section>
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
        className={`flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 ${FOCUS_RING}`}
      >
        <Add size={14} />
      </button>
    </Tooltip>
  );
}
