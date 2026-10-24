import { SectionLabel } from "@/components/ui/section-label";
import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useSidebarSharedAgents } from "../hooks/use-sidebar-agents.js";
import { AgentAvatar, avatarMood } from "./avatar/agent-avatar.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The legacy sidebar's Shared with me section: the
 * Agents another person owns and named this person an Agent Editor of. It
 * sits below the person's own agents, so they always know whose agent they
 * are on, and is hidden while nothing is shared. A row opens the agent's
 * page, since an editor has no sessions with it.
 */
export function SidebarSharedAgents({
  stickyHeaderClassName,
  onNavigate,
}: {
  stickyHeaderClassName: string;
  onNavigate?: () => void;
}) {
  const { shared, active, folded, openAgentId } = useSidebarSharedAgents();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const showFolded = useStore((s) => s.sidebarShowHibernating);
  const setShowFolded = useStore((s) => s.setSidebarShowHibernating);
  if (shared.length === 0) return null;
  const shown = showFolded ? shared : active;

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
        {shown.map((agent) => (
          <SharedAgentRow
            key={agent.id}
            agent={agent}
            current={agent.id === openAgentId}
            onSelect={() => {
              navigateToSandboxHome(agent.id);
              onNavigate?.();
            }}
          />
        ))}
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
  onSelect,
}: {
  agent: AgentView;
  current: boolean;
  onSelect: () => void;
}) {
  const mood = avatarMood(agent.state, agent);
  return (
    <li>
      <div
        {...clickableProps(onSelect)}
        aria-current={current ? "page" : undefined}
        data-testid="sidebar-shared-agent-row"
        className={cn(
          "flex h-9 min-w-0 cursor-pointer items-center gap-3 rounded-lg pr-2 pl-3 text-left transition-colors select-none",
          current ? "bg-muted text-foreground" : "hover:bg-muted",
          !current &&
            (mood !== "awake"
              ? "text-muted-foreground hover:text-foreground"
              : "text-foreground/90 hover:text-foreground"),
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
    </li>
  );
}
