import type { ReactNode } from "react";

import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { useAutoWakeOnSidebarOpen } from "../hooks/use-auto-wake-on-sidebar-open.js";
import { useOrderDrag } from "../hooks/use-order-drag.js";
import { isSharedAgent } from "../lib/agent-editors.js";
import type { OrderDrop } from "../lib/sidebar-order.js";
import { AgentAvatar, avatarMood } from "./avatar/agent-avatar.js";
import { OrderDropIndicator } from "./order-drop-indicator.js";
import { SharedAgentIcon } from "./shared-agent-icon.js";

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
  onOpenPeople: () => void;
  actions: ReactNode;
  filter: ReactNode;
  filtered: boolean;
  children?: ReactNode;
}

const HOVER_REVEAL =
  "transition-opacity group-hover/agent:opacity-100 group-focus-within/agent:opacity-100 group-has-[[data-state=open]]/agent:opacity-100";
const HIDDEN_UNTIL_HOVER =
  "pointer-events-none opacity-0 group-hover/agent:pointer-events-auto group-focus-within/agent:pointer-events-auto group-has-[[data-state=open]]/agent:pointer-events-auto";

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
  onOpenPeople,
  actions,
  filter,
  filtered,
  children,
}: Props) {
  useAutoWakeOnSidebarOpen(agent, open);
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
            "flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg pr-2 pl-3 text-left select-none",
            selected
              ? "pr-[86px]"
              : ["group-hover/agent:pr-[86px]", filtered && "pr-[34px]"],
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
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              title={agent.name}
              className="min-w-0 truncate text-sm font-medium"
            >
              {agent.name}
            </span>
            {isSharedAgent(agent) && (
              <SharedAgentIcon
                editors={agent.access.editors}
                onOpen={onOpenPeople}
              />
            )}
          </span>
          {unread && (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center",
                  !selected && "group-hover/agent:hidden",
                )}
              >
                <span className="size-2 rounded-full bg-accent" />
              </span>
              <span className="sr-only">(unread)</span>
            </>
          )}
        </div>
        <div className="absolute right-1 flex items-center gap-0.5">
          <div
            className={cn(
              "flex items-center",
              HOVER_REVEAL,
              selected || filtered ? "opacity-100" : HIDDEN_UNTIL_HOVER,
            )}
          >
            {filter}
          </div>
          <div
            className={cn(
              "flex items-center gap-0.5",
              HOVER_REVEAL,
              selected ? "opacity-100" : HIDDEN_UNTIL_HOVER,
            )}
          >
            {actions}
          </div>
        </div>
        <OrderDropIndicator at={drag.indicator} />
      </div>
      {children}
    </li>
  );
}
