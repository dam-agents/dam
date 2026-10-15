import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { AgentAvatar, avatarMood } from "./avatar/agent-avatar.js";

interface Props {
  agent: AgentView;
  selected: boolean;
  unread: boolean;
  onSelect: () => void;
  actions: ReactNode;
  children?: ReactNode;
}

export function SidebarAgentRow({
  agent,
  selected,
  unread,
  onSelect,
  actions,
  children,
}: Props) {
  const mood = avatarMood(agent.state, agent.stopRequested);
  return (
    <li>
      <div
        className={cn(
          "group/agent relative flex items-center rounded-lg transition-colors",
          selected ? "bg-muted" : "hover:bg-muted",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "page" : undefined}
          data-testid="sidebar-agent-row"
          className={cn(
            "flex h-[34px] min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-left",
            selected ? "pr-[84px]" : "group-hover/agent:pr-[60px]",
            selected
              ? "text-foreground"
              : mood === "asleep"
                ? "text-muted-foreground hover:text-foreground"
                : "text-foreground/90 hover:text-foreground",
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
                className={cn(
                  "size-2 shrink-0 rounded-full bg-accent group-hover/agent:hidden",
                  selected && "hidden",
                )}
              />
              <span className="sr-only">(unread)</span>
            </>
          )}
        </button>
        <div
          className={cn(
            "absolute right-1 flex items-center gap-0.5 transition-opacity focus-within:opacity-100 group-hover/agent:opacity-100 has-[[data-state=open]]:opacity-100",
            selected
              ? "opacity-100"
              : "pointer-events-none opacity-0 focus-within:pointer-events-auto group-hover/agent:pointer-events-auto has-[[data-state=open]]:pointer-events-auto",
          )}
        >
          {actions}
        </div>
      </div>
      {children}
    </li>
  );
}
