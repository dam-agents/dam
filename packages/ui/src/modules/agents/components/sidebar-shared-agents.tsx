import type { ReactNode } from "react";

import { SectionLabel } from "@/components/ui/section-label";
import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useStartSession } from "../../sessions/hooks/use-start-session.js";
import { shownSessionId } from "../../sessions/lib/shown-session.js";
import { useSidebarSharedAgents } from "../hooks/use-sidebar-agents.js";
import { holds } from "../lib/agent-permissions.js";
import { AgentAvatar } from "./avatar/agent-avatar.js";
import { SidebarSessionActions } from "./sidebar-agent-actions.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the sidebar's Shared with me section: the
 * Agents another person owns and named this person an Agent Editor of. In
 * All agents it sits below the person's own agents, so they always know
 * whose agent they are on, and is hidden while nothing is shared. A row the
 * person may use sessions on narrows the sidebar to that Agent and opens its
 * new chat, as an own Agent does; any other row opens the agent's settings.
 * In an agent view it shows only the selected Agent, when that one is shared.
 */
export function SidebarSharedAgents({
  stickyHeaderClassName,
  onNavigate,
}: {
  stickyHeaderClassName: string;
  onNavigate?: () => void;
}) {
  const { shared, openAgentId, sidebarAgent } = useSidebarSharedAgents();
  const openAgentSettings = useStore((s) => s.openAgentSettings);
  const setSidebarAgent = useStore((s) => s.setSidebarAgent);
  const sessionOpen = useStore((s) => s.view === "chat" && !!shownSessionId(s));
  const startSession = useStartSession();
  const navigate = (go: () => void) => () => {
    go();
    onNavigate?.();
  };

  const row = (agent: AgentView) => {
    const current = agent.id === openAgentId && !sessionOpen;
    const configure = navigate(() => openAgentSettings(agent.id));
    if (!holds(agent.access, "sessions"))
      return (
        <SharedAgentRow
          key={agent.id}
          agent={agent}
          current={current}
          onSelect={configure}
        />
      );
    return (
      <SharedAgentRow
        key={agent.id}
        agent={agent}
        current={current}
        selected={agent.id === sidebarAgent}
        onSelect={navigate(() => {
          setSidebarAgent(agent.id);
          startSession(agent.id);
        })}
        actions={
          <SidebarSessionActions
            onNewSession={navigate(() => startSession(agent.id))}
            onConfigure={configure}
          />
        }
      />
    );
  };

  if (sidebarAgent !== null) {
    const viewed = shared.find((agent) => agent.id === sidebarAgent);
    return viewed ? (
      <ul className="flex flex-col gap-px" data-testid="sidebar-shared-agents">
        {row(viewed)}
      </ul>
    ) : null;
  }
  if (shared.length === 0) return null;

  return (
    <section
      aria-label="Shared with me"
      className="mt-6"
      data-testid="sidebar-shared-agents"
    >
      <div
        className={cn(
          "sticky top-0 z-raised mb-1.5 flex items-center pt-3 pr-1 pb-1 pl-3",
          stickyHeaderClassName,
        )}
      >
        <SectionLabel>Shared with me</SectionLabel>
      </div>
      <ul className="flex flex-col gap-px">{shared.map(row)}</ul>
    </section>
  );
}

function SharedAgentRow({
  agent,
  current,
  selected = false,
  onSelect,
  actions,
}: {
  agent: AgentView;
  current: boolean;
  selected?: boolean;
  onSelect: () => void;
  actions?: ReactNode;
}) {
  return (
    <li data-testid="sidebar-shared-agent" data-agent-id={agent.id}>
      <div
        className={cn(
          "group/agent relative flex items-center rounded-lg transition-colors",
          current || selected ? "bg-muted" : "hover:bg-muted",
        )}
      >
        <div
          {...clickableProps(onSelect)}
          aria-current={current ? "page" : undefined}
          data-testid="sidebar-shared-agent-row"
          className={cn(
            "flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg pr-2 pl-3 text-left select-none",
            actions && "group-hover/agent:pr-15",
            selected
              ? "text-foreground"
              : "text-foreground/90 hover:text-foreground",
          )}
        >
          <AgentAvatar
            name={agent.name}
            avatar={agent.avatar}
            size={24}
            className="shrink-0"
          />
          <span
            title={agent.name}
            className="min-w-0 flex-1 truncate text-sm font-medium"
          >
            {agent.name}
          </span>
        </div>
        {actions && (
          <div className="pointer-events-none absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/agent:pointer-events-auto group-focus-within/agent:opacity-100 group-hover/agent:pointer-events-auto group-hover/agent:opacity-100">
            {actions}
          </div>
        )}
      </div>
    </li>
  );
}
