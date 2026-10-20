import type { ReactNode } from "react";

import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { useOrderDrag } from "../hooks/use-order-drag.js";
import type { OrderDrop } from "../lib/sidebar-order.js";
import { AgentAvatar, avatarMood } from "./avatar/agent-avatar.js";
import { OrderDropIndicator } from "./order-drop-indicator.js";

interface Props {
  agent: AgentView;
  open: boolean;
  selected: boolean;
  current: boolean;
  unread: boolean;
  orderReady: boolean;
  onMove: (agentId: string, drop: OrderDrop) => void;
  onStep: (agentId: string, step: -1 | 1) => void;
  onSelect: () => void;
  actions: ReactNode;
  actionCount: 2 | 3;
  children?: ReactNode;
}

const ACTIONS_PADDING = {
  2: { shown: "pr-[60px]", hover: "group-hover/agent:pr-[60px]" },
  3: { shown: "pr-[86px]", hover: "group-hover/agent:pr-[86px]" },
} as const;

export function SidebarAgentRow({
  agent,
  open,
  selected,
  current,
  unread,
  orderReady,
  onMove,
  onStep,
  onSelect,
  actions,
  actionCount,
  children,
}: Props) {
  const mood = avatarMood(agent.state, agent);
  const drag = useOrderDrag({
    scope: "agents",
    id: agent.id,
    ready: orderReady,
    onMove,
    onStep,
  });
  return (
    <li>
      <div
        {...drag.dragProps}
        className={cn(
          "group group/agent relative flex items-center rounded-lg transition-colors",
          current ? "bg-muted" : "hover:bg-muted",
        )}
      >
        <div
          {...clickableProps(onSelect)}
          aria-current={current ? "page" : undefined}
          aria-expanded={open}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          data-testid="sidebar-agent-row"
          className={cn(
            "flex h-[34px] min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg pr-2 pl-2.5 text-left select-none",
            selected
              ? ACTIONS_PADDING[actionCount].shown
              : ACTIONS_PADDING[actionCount].hover,
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
          <span
            title={agent.name}
            className="min-w-0 flex-1 truncate text-sm font-medium"
          >
            {agent.name}
          </span>
          {unread && (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center group-hover/agent:hidden",
                  selected && "hidden",
                )}
              >
                <span className="size-2 rounded-full bg-accent" />
              </span>
              <span className="sr-only">(unread)</span>
            </>
          )}
        </div>
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
        <OrderDropIndicator at={drag.indicator} />
      </div>
      {children}
    </li>
  );
}
