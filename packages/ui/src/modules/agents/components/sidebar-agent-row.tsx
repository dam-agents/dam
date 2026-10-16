import { PinFilled } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { usePinDrag } from "../hooks/use-pin-drag.js";
import type { PinDrop } from "../lib/sidebar-pins.js";
import { AgentAvatar, avatarMood } from "./avatar/agent-avatar.js";
import { PinDropIndicator } from "./pin-drop-indicator.js";

interface Props {
  agent: AgentView;
  open: boolean;
  current: boolean;
  unread: boolean;
  pinned: boolean;
  onMovePin: (agentId: string, drop: PinDrop) => void;
  onStepPin: (agentId: string, step: -1 | 1) => void;
  onSelect: () => void;
  actions: ReactNode;
  children?: ReactNode;
}

export function SidebarAgentRow({
  agent,
  open,
  current,
  unread,
  pinned,
  onMovePin,
  onStepPin,
  onSelect,
  actions,
  children,
}: Props) {
  const mood = avatarMood(agent.state, agent);
  const drag = usePinDrag({
    scope: "agents",
    id: agent.id,
    pinned,
    onMove: onMovePin,
    onStep: onStepPin,
  });
  return (
    <li>
      <div
        {...drag.dragProps}
        data-pinned={pinned ? "true" : undefined}
        className={cn(
          "group group/agent relative flex items-center rounded-lg transition-colors",
          current ? "bg-muted" : "hover:bg-muted",
        )}
      >
        <div
          {...clickableProps(onSelect)}
          aria-current={current ? "page" : undefined}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          data-testid="sidebar-agent-row"
          className={cn(
            "flex h-[34px] min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left select-none",
            open ? "pr-[110px]" : "group-hover/agent:pr-[86px]",
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
            size={20}
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
                "shrink-0 text-muted-foreground group-hover/agent:hidden group-has-[button:focus]/agent:hidden group-has-[[data-state=open]]/agent:hidden",
                open && "hidden",
              )}
            />
          )}
          {unread && (
            <>
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full bg-accent group-hover/agent:hidden",
                  open && "hidden",
                )}
              />
              <span className="sr-only">(unread)</span>
            </>
          )}
        </div>
        <div
          className={cn(
            "absolute right-1 flex items-center gap-0.5 transition-opacity focus-within:opacity-100 group-hover/agent:opacity-100 has-[[data-state=open]]:opacity-100",
            open
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
