import type { ReactNode } from "react";

import { SectionLabel } from "@/components/ui/section-label";
import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { SidebarAgentSessions } from "../../sessions/components/sidebar-agent-sessions.js";
import { useStartSession } from "../../sessions/hooks/use-start-session.js";
import { useSidebarSharedAgents } from "../hooks/use-sidebar-agents.js";
import { holds } from "../lib/agent-permissions.js";
import { AgentAvatar, avatarMood } from "./avatar/agent-avatar.js";
import { SidebarSessionActions } from "./sidebar-agent-actions.js";

const NO_PREVIEW: never[] = [];
const noConversation = () => undefined;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The legacy sidebar's Shared with me section: the
 * Agents another person owns and named this person an Agent Editor of. It
 * sits below the person's own agents, so they always know whose agent they
 * are on, and is hidden while nothing is shared. A row the person may use
 * sessions on opens to the agent's Sessions, read from the agent itself, as
 * the attention record that previews the person's own agents holds none of
 * them; any other row opens the agent's page.
 */
export function SidebarSharedAgents({
  stickyHeaderClassName,
  onNavigate,
}: {
  stickyHeaderClassName: string;
  onNavigate?: () => void;
}) {
  const { shared, active, folded, openAgentId, sessionOpen, isOpen } =
    useSidebarSharedAgents();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setAgentOpen = useStore((s) => s.setSidebarAgentOpen);
  const showFolded = useStore((s) => s.sidebarShowHibernating);
  const setShowFolded = useStore((s) => s.setSidebarShowHibernating);
  const startSession = useStartSession();
  if (shared.length === 0) return null;
  const shown = showFolded ? shared : active;
  const navigate = (go: () => void) => () => {
    go();
    onNavigate?.();
  };

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
      <ul className="flex flex-col gap-px">
        {shown.map((agent) => {
          const current = agent.id === openAgentId;
          const configure = navigate(() => navigateToSandboxHome(agent.id));
          if (!holds(agent.access, "sessions"))
            return (
              <SharedAgentRow
                key={agent.id}
                agent={agent}
                current={current}
                onSelect={configure}
              />
            );
          const open = isOpen(agent.id);
          return (
            <SharedAgentRow
              key={agent.id}
              agent={agent}
              current={current && !sessionOpen}
              open={open}
              onSelect={() => setAgentOpen(agent.id, !open)}
              actions={
                <SidebarSessionActions
                  onNewSession={navigate(() => startSession(agent.id))}
                  onConfigure={configure}
                />
              }
            >
              {open && (
                <SidebarAgentSessions
                  agentId={agent.id}
                  open={current}
                  preview={NO_PREVIEW}
                  previewComplete={false}
                  conversationOf={noConversation}
                  onNavigate={onNavigate}
                />
              )}
            </SharedAgentRow>
          );
        })}
      </ul>
      {folded.length > 0 && (
        <button
          type="button"
          onClick={() => setShowFolded(!showFolded)}
          aria-expanded={showFolded}
          className="mt-px flex h-[30px] w-full items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {showFolded ? "Show less" : `See all (${folded.length} hibernating)`}
        </button>
      )}
    </section>
  );
}

function SharedAgentRow({
  agent,
  current,
  open,
  onSelect,
  actions,
  children,
}: {
  agent: AgentView;
  current: boolean;
  open?: boolean;
  onSelect: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const mood = avatarMood(agent.state, agent);
  return (
    <li data-testid="sidebar-shared-agent" data-agent-id={agent.id}>
      <div
        className={cn(
          "group/agent relative flex items-center rounded-lg transition-colors",
          current ? "bg-muted" : "hover:bg-muted",
        )}
      >
        <div
          {...clickableProps(onSelect)}
          aria-current={current ? "page" : undefined}
          aria-expanded={open}
          data-testid="sidebar-shared-agent-row"
          className={cn(
            "flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg pr-2 pl-3 text-left select-none",
            actions && "group-hover/agent:pr-15",
            open
              ? "text-foreground"
              : mood !== "awake"
                ? "text-muted-foreground hover:text-foreground"
                : "text-foreground/90 hover:text-foreground",
          )}
        >
          <AgentAvatar
            name={agent.name}
            avatar={agent.avatar}
            size={24}
            mood={mood}
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
      {children}
    </li>
  );
}
