import { PinFilled } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { usePinDrag } from "../hooks/use-pin-drag.js";
import type { PinDrop } from "../lib/sidebar-pins.js";
import { AgentAvatar, avatarMood } from "./avatar/agent-avatar.js";
import { PinDropIndicator } from "./pin-drop-indicator.js";

interface Props {
  agent: AgentView;
  selected: boolean;
  unread: boolean;
  pinned: boolean;
  onMovePin: (agentId: string, drop: PinDrop | null) => void;
  onSelect: () => void;
  actions: ReactNode;
  children?: ReactNode;
}

export function SidebarAgentRow({
  agent,
  selected,
  unread,
  pinned,
  onMovePin,
  onSelect,
  actions,
  children,
}: Props) {
  const mood = avatarMood(agent.state, agent);
  const drag = usePinDrag({ scope: "agents", id: agent.id, onMove: onMovePin });
  return (
    <li>
      <div
        {...drag.dragProps}
        data-pinned={pinned ? "true" : undefined}
        className={cn(
          "group group/agent relative flex items-center rounded-lg transition-colors",
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
            selected ? "pr-[110px]" : "group-hover/agent:pr-[86px]",
            selected
              ? "text-foreground"
              : mood !== "awake"
                ? "text-muted-foreground hover:text-foreground"
                : "text-foreground/90 hover:text-foreground",
          )}
        >
          <AgentAvatar
            name={agent.name}
            avatar={agent.avatar}
            size={18}
            mood={mood}
            className="shrink-0"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {agent.name}
          </span>
          {pinned && (
            <PinFilled
              size={12}
              aria-label="Pinned"
              className={cn(
                "shrink-0 text-muted-foreground group-hover/agent:hidden",
                selected && "hidden",
              )}
            />
          )}
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
        <PinDropIndicator at={drag.indicator} />
      </div>
      {children}
    </li>
  );
}
