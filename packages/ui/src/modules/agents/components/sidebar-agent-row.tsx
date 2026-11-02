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
  actionCount: 3 | 4;
  filter: ReactNode;
  filtered: boolean;
  children?: ReactNode;
}

const ACTIONS_LAYOUT = {
  3: {
    padding: {
      shown: "pr-[86px]",
      revealed:
        "group-hover/agent:pr-[86px] group-focus-within/agent:pr-[86px] group-has-[[data-state=open]]/agent:pr-[86px]",
    },
    filter: {
      shown: "right-[56px]",
      revealed:
        "group-hover/agent:right-[56px] group-focus-within/agent:right-[56px] group-has-[[data-state=open]]/agent:right-[56px]",
    },
  },
  4: {
    padding: {
      shown: "pr-[112px]",
      revealed:
        "group-hover/agent:pr-[112px] group-focus-within/agent:pr-[112px] group-has-[[data-state=open]]/agent:pr-[112px]",
    },
    filter: {
      shown: "right-[82px]",
      revealed:
        "group-hover/agent:right-[82px] group-focus-within/agent:right-[82px] group-has-[[data-state=open]]/agent:right-[82px]",
    },
  },
} as const;

const HOVER_REVEAL =
  "transition-opacity group-hover/agent:opacity-100 group-focus-within/agent:opacity-100 group-has-[[data-state=open]]/agent:opacity-100";
const HIDDEN_UNTIL_HOVER =
  "pointer-events-none opacity-0 group-hover/agent:pointer-events-auto group-focus-within/agent:pointer-events-auto group-has-[[data-state=open]]/agent:pointer-events-auto";
const HIDDEN_WHEN_REVEALED =
  "group-hover/agent:hidden group-focus-within/agent:hidden group-has-[[data-state=open]]/agent:hidden";

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
  actionCount,
  filter,
  filtered,
  children,
}: Props) {
  useAutoWakeOnSidebarOpen(agent, open);
  const mood = avatarMood(agent.state, agent);
  const layout = ACTIONS_LAYOUT[actionCount];
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
              ? layout.padding.shown
              : [layout.padding.revealed, filtered && !unread && "pr-[34px]"],
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
                  !selected && [HIDDEN_WHEN_REVEALED, filtered && "ml-6"],
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
            "absolute flex items-center",
            HOVER_REVEAL,
            selected
              ? [layout.filter.shown, "opacity-100"]
              : [
                  layout.filter.revealed,
                  unread ? "right-6" : "right-1",
                  filtered ? "opacity-100" : HIDDEN_UNTIL_HOVER,
                ],
          )}
        >
          {filter}
        </div>
        <div
          className={cn(
            "absolute right-1 flex items-center gap-0.5",
            HOVER_REVEAL,
            selected ? "opacity-100" : HIDDEN_UNTIL_HOVER,
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
