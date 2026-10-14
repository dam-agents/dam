import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { AgentAvatar, avatarMood } from "./avatar/agent-avatar.js";

interface Props {
  agent: AgentView;
  selected: boolean;
  unread: boolean;
  working: boolean;
  onSelect: () => void;
}

export function SidebarAgentRow({
  agent,
  selected,
  unread,
  working,
  onSelect,
}: Props) {
  const mood = avatarMood(agent.state, agent.stopRequested, working);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "page" : undefined}
        data-testid="sidebar-agent-row"
        className={cn(
          "flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors",
          selected
            ? "bg-muted text-foreground"
            : "text-foreground/90 hover:bg-muted hover:text-foreground",
          mood === "asleep" && !selected && "text-muted-foreground",
        )}
      >
        <AgentAvatar
          name={agent.name}
          avatar={agent.avatar}
          size={18}
          mood={mood}
          className={cn("shrink-0", mood === "asleep" && "opacity-60")}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {agent.name}
        </span>
        {unread && (
          <>
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-accent"
            />
            <span className="sr-only">(unread)</span>
          </>
        )}
      </button>
    </li>
  );
}
