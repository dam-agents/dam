import { FOCUS_RING } from "@/components/ui/focus-ring";
import {
  ACTIVE_ITEM,
  HOVER_ITEM,
  RAIL_AVATAR,
  RAIL_GAP,
  RAIL_ROW,
  railTile,
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
import { useSidebarSharedAgents } from "../../../agents/hooks/use-sidebar-agents.js";
import { TREE_AGENT_NAME_MAX, TREE_AVATAR, TREE_LEADING } from "./add-row.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The tree's Shared with me section, after the
 * person's own Agents: the Agents another person owns and named this person
 * an Agent Editor of. Hidden while nothing is shared. A row opens the
 * agent's page rather than its sessions, since an editor has none with it,
 * and keeps no manual order, which belongs to the owner.
 */
export function SharedAgentNodes({ onNavigate }: { onNavigate?: () => void }) {
  const { shared, openAgentId } = useSidebarSharedAgents();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
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
        {shared.map((agent) => (
          <SharedAgentNode
            key={agent.id}
            agent={agent}
            current={agent.id === openAgentId}
            onOpen={() => {
              navigateToSandboxHome(agent.id);
              onNavigate?.();
            }}
          />
        ))}
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Shared Agents in the collapsed rail, one
 * avatar each after the person's own Agents, named "Shared with me" in its
 * tooltip so it never reads as their own. A tile opens the agent's page.
 */
export function SharedAgentTiles({ onNavigate }: { onNavigate: () => void }) {
  const { shared, openAgentId } = useSidebarSharedAgents();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  return shared.map((agent) => (
    <Tooltip
      key={agent.id}
      side="right"
      content={`${agent.name} · Shared with me`}
    >
      <button
        type="button"
        aria-label={`${agent.name}, shared with me`}
        aria-current={agent.id === openAgentId ? "page" : undefined}
        data-testid="sidebar-rail-shared-agent"
        data-agent-id={agent.id}
        className={cn(railTile(agent.id === openAgentId), FOCUS_RING)}
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
  ));
}
