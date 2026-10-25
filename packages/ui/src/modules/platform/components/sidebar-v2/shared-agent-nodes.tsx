import { Add, ChevronRight, Tools } from "@carbon/icons-react";
import { useId } from "react";

import { Collapse } from "@/components/ui/collapse";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import {
  ACTIVE_ITEM,
  HOVER_ITEM,
  RAIL_AVATAR,
  RAIL_GAP,
  RAIL_ROW,
  railTile,
  SIDEBAR_GLYPH,
  SQUIRCLE,
} from "@/components/ui/rail-tile";
import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../../agents/components/avatar/agent-avatar.js";
import { useAutoWakeOnSidebarOpen } from "../../../agents/hooks/use-auto-wake-on-sidebar-open.js";
import { useSidebarSharedAgents } from "../../../agents/hooks/use-sidebar-agents.js";
import { holds } from "../../../agents/lib/agent-permissions.js";
import { useStartSession } from "../../../sessions/hooks/use-start-session.js";
import {
  isExpanded,
  openWithPage,
  toggleExpanded,
} from "../../lib/sidebar-tree.js";
import {
  AddRow,
  TREE_AGENT_NAME_MAX,
  TREE_AVATAR,
  TREE_LEADING,
} from "./add-row.js";
import { AgentSessionList } from "./agent-session-list.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The tree's Shared with me section, after the
 * person's own Agents: the Agents another person owns and named this person
 * an Agent Editor of. Hidden while nothing is shared. A row the person may
 * use sessions on acts like their own agents' rows: a click on it closed
 * opens the agent's new-session page and its Sessions, a click on it open
 * closes them, and its chevron only opens and closes them; any other row
 * opens the agent's page. The rows keep no manual order, which
 * belongs to the owner.
 */
export function SharedAgentNodes({ onNavigate }: { onNavigate?: () => void }) {
  const { shared, openAgentId, sessionOpen } = useSidebarSharedAgents();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const toggled = useStore((s) => s.sidebarTreeToggled);
  const setToggled = useStore((s) => s.setSidebarTreeToggled);
  if (shared.length === 0) return null;
  return (
    <section
      aria-label="Shared with me"
      className="mt-3"
      data-testid="sidebar-shared-agents"
    >
      <div className="flex h-8 items-center pr-1 pl-2">
        <SectionLabel>Shared with me</SectionLabel>
      </div>
      <ul className={cn("flex flex-col", RAIL_GAP)}>
        {shared.map((agent) =>
          holds(agent.access, "sessions") ? (
            <SharedAgentSessionsNode
              key={agent.id}
              agent={agent}
              current={agent.id === openAgentId && !sessionOpen}
              expanded={isExpanded(toggled, agent.id, openAgentId)}
              onToggle={() =>
                setToggled(toggleExpanded(toggled, agent.id, openAgentId))
              }
              onOpen={() => setToggled(openWithPage(toggled, agent.id))}
              onNavigate={onNavigate}
            />
          ) : (
            <SharedAgentNode
              key={agent.id}
              agent={agent}
              current={agent.id === openAgentId}
              onOpen={() => {
                navigateToSandboxHome(agent.id);
                onNavigate?.();
              }}
            />
          ),
        )}
      </ul>
    </section>
  );
}

function SharedAgentNode({
  agent,
  current,
  onOpen,
}: {
  agent: AgentView;
  current: boolean;
  onOpen: () => void;
}) {
  const mood = avatarMood(agent.state, agent);
  return (
    <li data-testid="sidebar-shared-agent" data-agent-id={agent.id}>
      <button
        type="button"
        onClick={onOpen}
        aria-current={current ? "page" : undefined}
        data-testid="sidebar-shared-agent-row"
        className={cn(
          SQUIRCLE,
          "flex w-full min-w-0 items-center gap-2.5 rounded-lg pl-0 text-left select-none",
          RAIL_ROW,
          current ? ACTIVE_ITEM : HOVER_ITEM,
          FOCUS_RING,
          mood !== "awake"
            ? "text-muted-foreground hover:text-foreground"
            : "text-foreground",
        )}
      >
        <span className={cn(TREE_LEADING, "items-center")}>
          <AgentAvatar
            name={agent.name}
            avatar={agent.avatar}
            size={TREE_AVATAR}
            mood={mood}
          />
        </span>
        <span
          title={agent.name}
          className={cn("truncate text-sm font-medium", TREE_AGENT_NAME_MAX)}
        >
          {agent.name}
        </span>
      </button>
    </li>
  );
}

function SharedAgentSessionsNode({
  agent,
  current,
  expanded,
  onToggle,
  onOpen,
  onNavigate,
}: {
  agent: AgentView;
  current: boolean;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onNavigate: (() => void) | undefined;
}) {
  useAutoWakeOnSidebarOpen(agent, expanded);
  const newSessionPage = useStore(
    (s) => s.view === "chat" && s.selectedAgent === agent.id && !s.sessionId,
  );
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const startSession = useStartSession();
  const mood = avatarMood(agent.state, agent);
  const listId = useId();
  const go = (fn: () => void) => () => {
    fn();
    onNavigate?.();
  };
  return (
    <li
      data-testid="sidebar-shared-agent"
      data-agent-id={agent.id}
      data-expanded={expanded || undefined}
    >
      <div
        className={cn(
          "group/agent relative flex items-center rounded-lg transition-colors",
          current && !newSessionPage ? ACTIVE_ITEM : HOVER_ITEM,
        )}
      >
        <button
          type="button"
          onClick={
            expanded
              ? onToggle
              : go(() => {
                  onOpen();
                  startSession(agent.id);
                })
          }
          aria-current={current && !newSessionPage ? "page" : undefined}
          data-testid="sidebar-shared-agent-row"
          data-agent-main
          className={cn(
            SQUIRCLE,
            "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg pl-0 text-left select-none",
            RAIL_ROW,
            "pr-2 group-hover/agent:pr-10 group-has-focus-visible/agent:pr-10",
            FOCUS_RING,
            mood !== "awake" && !expanded
              ? "text-muted-foreground hover:text-foreground"
              : "text-foreground",
          )}
        >
          <span className={cn(TREE_LEADING, "items-center")}>
            <AgentAvatar
              name={agent.name}
              avatar={agent.avatar}
              size={TREE_AVATAR}
              mood={mood}
              className="group-has-focus-visible/agent:invisible group-hover/agent:invisible [@media(hover:none)]:invisible"
            />
          </span>
          <span
            title={agent.name}
            className={cn("truncate text-sm font-medium", TREE_AGENT_NAME_MAX)}
          >
            {agent.name}
          </span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-label={`Sessions of ${agent.name}`}
          data-testid="sidebar-shared-agent-toggle"
          className={cn(
            "absolute inset-y-0 left-0 w-10 items-center justify-center rounded-lg text-muted-foreground",
            "flex opacity-0 group-has-focus-visible/agent:opacity-100 group-hover/agent:opacity-100 [@media(hover:none)]:opacity-100",
            FOCUS_RING,
          )}
        >
          <ChevronRight
            size={SIDEBAR_GLYPH}
            aria-hidden
            className={cn(
              "transition-transform motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
        </button>
        <SharedAgentConfigureButton
          name={agent.name}
          className="absolute right-1 opacity-0 transition-opacity group-has-focus-visible/agent:opacity-100 group-hover/agent:opacity-100 [@media(hover:none)]:opacity-100"
          onClick={go(() => navigateToSandboxHome(agent.id))}
        />
      </div>
      <Collapse open={expanded}>
        <div className="pt-px pb-3" id={listId}>
          <AgentSessionList
            agentId={agent.id}
            onNavigate={onNavigate}
            newSessionRow={
              <AddRow
                icon={Add}
                label="New session"
                ariaLabel={`New session with ${agent.name}`}
                testId="sidebar-new-session-row"
                current={newSessionPage}
                onClick={go(() => startSession(agent.id))}
              />
            }
          />
        </div>
      </Collapse>
    </li>
  );
}

export function SharedAgentConfigureButton({
  name,
  className,
  onClick,
}: {
  name: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content="Configure agent" side="bottom">
      <button
        type="button"
        aria-label={`Configure ${name}`}
        onClick={onClick}
        className={cn(
          "flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground",
          FOCUS_RING,
          className,
        )}
      >
        <Tools size={14} />
      </button>
    </Tooltip>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A Shared Agent's tile in the collapsed rail for
 * a person who may not use its sessions, named "Shared with me" in its
 * tooltip so it never reads as their own. The tile opens the agent's page.
 */
export function SharedAgentPageTile({
  agent,
  current,
  onNavigate,
}: {
  agent: AgentView;
  current: boolean;
  onNavigate: () => void;
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  return (
    <Tooltip side="right" content={`${agent.name} · Shared with me`}>
      <button
        type="button"
        aria-label={`${agent.name}, shared with me`}
        aria-current={current ? "page" : undefined}
        data-testid="sidebar-rail-shared-agent"
        data-agent-id={agent.id}
        className={cn(railTile(current), FOCUS_RING)}
        onClick={() => {
          navigateToSandboxHome(agent.id);
          onNavigate();
        }}
      >
        <AgentAvatar
          name={agent.name}
          avatar={agent.avatar}
          size={RAIL_AVATAR}
          mood={avatarMood(agent.state, agent)}
        />
      </button>
    </Tooltip>
  );
}
