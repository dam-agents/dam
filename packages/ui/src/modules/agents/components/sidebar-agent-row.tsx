import { Filter } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { useAutoWakeOnSidebarOpen } from "../hooks/use-auto-wake-on-sidebar-open.js";
import { useOrderDrag } from "../hooks/use-order-drag.js";
import { isSharedAgent } from "../lib/agent-editors.js";
import type { OrderDrop } from "../lib/sidebar-order.js";
import { AgentAvatar } from "./avatar/agent-avatar.js";
import { OrderDropIndicator } from "./order-drop-indicator.js";
import { SharedAgentIcon } from "./shared-agent-icon.js";

interface Props {
  agent: AgentView;
  viewing: boolean;
  selected: boolean;
  current: boolean;
  unread: boolean;
  filtered: boolean;
  orderReady: boolean;
  onMove: (agentId: string, drop: OrderDrop) => void;
  onStep: (agentId: string, step: -1 | 1) => void;
  onSelect: () => void;
  onOpenPeople: () => void;
  actions: ReactNode;
  actionCount: 2 | 3;
}

const ACTIONS_PADDING = {
  2: {
    shown: "pr-[60px]",
    revealed:
      "group-hover/agent:pr-[60px] group-focus-within/agent:pr-[60px] group-has-[[data-state=open]]/agent:pr-[60px]",
  },
  3: {
    shown: "pr-[86px]",
    revealed:
      "group-hover/agent:pr-[86px] group-focus-within/agent:pr-[86px] group-has-[[data-state=open]]/agent:pr-[86px]",
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
  viewing,
  selected,
  current,
  unread,
  filtered,
  orderReady,
  onMove,
  onStep,
  onSelect,
  onOpenPeople,
  actions,
  actionCount,
}: Props) {
  useAutoWakeOnSidebarOpen(agent, viewing);
  const padding = ACTIONS_PADDING[actionCount];
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
          current || selected ? "bg-muted" : "hover:bg-muted",
        )}
      >
        <div
          {...clickableProps(onSelect)}
          aria-current={current ? "page" : undefined}
          aria-keyshortcuts={
            orderReady ? "Alt+ArrowUp Alt+ArrowDown" : undefined
          }
          data-testid="sidebar-agent-row"
          data-agent-id={agent.id}
          className={cn(
            "flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg pr-2 pl-3 text-left select-none",
            selected ? padding.shown : padding.revealed,
            selected
              ? "text-foreground"
              : "text-foreground/90 hover:text-foreground",
          )}
        >
          <AgentAvatar
            name={agent.name}
            avatar={agent.avatar}
            size={24}
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
          {filtered && (
            <span
              data-testid="sidebar-agent-filtered"
              title="Sessions filtered"
              className={cn(
                "flex size-4 shrink-0 items-center justify-center text-primary",
                !selected && HIDDEN_WHEN_REVEALED,
              )}
            >
              <Filter size={12} aria-hidden />
              <span className="sr-only">(sessions filtered)</span>
            </span>
          )}
          {unread && (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center",
                  !selected && HIDDEN_WHEN_REVEALED,
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
            "absolute right-1 flex items-center gap-0.5",
            HOVER_REVEAL,
            selected ? "opacity-100" : HIDDEN_UNTIL_HOVER,
          )}
        >
          {actions}
        </div>
        <OrderDropIndicator at={drag.indicator} />
      </div>
    </li>
  );
}
