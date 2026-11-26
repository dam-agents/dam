import { ArrowLeft } from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useActivitySessions } from "../../home/hooks/use-activity-sessions.js";
import { MessengerBindDialog } from "../../sandboxes/components/channels/messenger-bind-dialog.js";
import type { BindMessenger } from "../../sandboxes/components/channels/messenger-instructions.js";
import { useAgentsWithUnreadListedSessions } from "../../sessions/api/queries.js";
import { useStartSession } from "../../sessions/hooks/use-start-session.js";
import { useAgentSessionFilters } from "../../sessions/lib/agent-session-filters.js";
import { shownSessionId } from "../../sessions/lib/shown-session.js";
import { findAgent, useAgents } from "../api/queries.js";
import { useSidebarAgents } from "../hooks/use-sidebar-agents.js";
import { useSidebarOrderActions } from "../hooks/use-sidebar-order-actions.js";
import { CreateAgentMenu } from "./create-agent-menu.js";
import {
  hasChannelActions,
  SidebarAgentActions,
} from "./sidebar-agent-actions.js";
import { SidebarAgentRow } from "./sidebar-agent-row.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the sidebar's Agents section. In All agents it
 * lists every one of the person's own Agents in their manual order; a click on one narrows the sidebar to that Agent and
 * opens its new chat. In an agent view it shows "All agents", which goes
 * back, and the selected Agent alone; a click on it opens its new chat
 * again. Sessions are never listed here: the Sessions section lists them.
 */
export function SidebarAgents({
  stickyHeaderClassName,
  onNavigate,
}: {
  stickyHeaderClassName: string;
  onNavigate?: () => void;
}) {
  const { agents, openAgentId, sidebarAgent, unreadAgentIds } =
    useSidebarAgents();
  const orderActions = useSidebarOrderActions();
  const activity = useActivitySessions();
  const agentsData = useAgents().data;
  const available = agentsData?.availableChannels ?? {};
  const openAgentSettings = useStore((s) => s.openAgentSettings);
  const setSidebarAgent = useStore((s) => s.setSidebarAgent);
  const setSidebarBackFrom = useStore((s) => s.setSidebarBackFrom);
  const sessionOpen = useStore((s) => s.view === "chat" && !!shownSessionId(s));
  const startSession = useStartSession();
  const listedUnread = useAgentsWithUnreadListedSessions(
    useStore(shownSessionId),
  );
  const [binding, setBinding] = useState<BindMessenger | null>(null);
  const agentFilters = useAgentSessionFilters();

  const viewGone =
    sidebarAgent !== null &&
    agentsData !== undefined &&
    !findAgent(agentsData, sidebarAgent);
  useEffect(() => {
    if (viewGone) setSidebarAgent(null);
  }, [viewGone, setSidebarAgent]);

  const navigate = (go: () => void) => () => {
    go();
    onNavigate?.();
  };

  const viewed =
    sidebarAgent === null
      ? undefined
      : agents.find((agent) => agent.id === sidebarAgent);
  const shownAgents = sidebarAgent === null ? agents : viewed ? [viewed] : [];
  const shownAgentIds = shownAgents.map((agent) => agent.id);
  const row = (agent: AgentView) => (
    <SidebarAgentRow
      key={agent.id}
      agent={agent}
      viewing={agent.id === sidebarAgent}
      selected={agent.id === sidebarAgent}
      current={agent.id === openAgentId && !sessionOpen}
      unread={unreadAgentIds.has(agent.id) || listedUnread.has(agent.id)}
      filtered={agentFilters.has(agent.id)}
      orderReady={orderActions.ready && !viewed}
      onMove={(id, drop) => orderActions.moveAgent(shownAgentIds, id, drop)}
      onStep={(id, step) => orderActions.stepAgent(shownAgentIds, id, step)}
      onSelect={navigate(() => {
        setSidebarAgent(agent.id);
        startSession(agent.id);
      })}
      onOpenPeople={navigate(() => openAgentSettings(agent.id, "people"))}
      actionCount={hasChannelActions(available) ? 3 : 2}
      actions={
        <SidebarAgentActions
          channels={available}
          onNewSession={navigate(() => startSession(agent.id))}
          onConfigure={navigate(() => openAgentSettings(agent.id))}
          onBind={setBinding}
        />
      }
    />
  );

  return (
    <section aria-label="Agents" data-testid="sidebar-agents">
      {sidebarAgent === null ? (
        <div
          className={cn(
            "sticky top-0 z-raised mb-1.5 flex items-center justify-between pt-3 pr-1 pb-1 pl-3",
            stickyHeaderClassName,
          )}
        >
          <SectionLabel>Agents</SectionLabel>
          <CreateAgentMenu onChoose={onNavigate} />
        </div>
      ) : (
        <AllAgentsButton
          onClick={() => {
            setSidebarBackFrom(sidebarAgent);
            setSidebarAgent(null);
            requestAnimationFrame(() => setSidebarBackFrom(null));
          }}
        />
      )}
      {sidebarAgent === null && activity.unreadable && (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
          Recent sessions can't be loaded right now.
        </p>
      )}
      <ul className="flex flex-col gap-px">{shownAgents.map(row)}</ul>
      {binding && (
        <MessengerBindDialog
          messenger={binding}
          onClose={() => setBinding(null)}
        />
      )}
    </section>
  );
}

function AllAgentsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="sidebar-all-agents"
      className={cn(
        "mt-3 mb-1 flex h-[30px] w-full items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        FOCUS_RING,
      )}
    >
      <ArrowLeft size={16} aria-hidden />
      All agents
    </button>
  );
}
