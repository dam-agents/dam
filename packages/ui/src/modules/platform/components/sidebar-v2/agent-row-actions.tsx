import { Add, Tools, TrashCan } from "@carbon/icons-react";
import type { ReactNode } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import { useDeleteAgent } from "../../../agents/api/mutations.js";
import { useConfirmDeleteAgent } from "../../../agents/hooks/use-confirm-delete-agent.js";
import { ActivityFilterMenu } from "../../../home/components/activity-filter-menu.js";
import { defaultActivityFilters } from "../../../home/lib/activity-filter.js";
import { useStartSession } from "../../../sessions/hooks/use-start-session.js";
import {
  setAgentSessionFilter,
  useAgentSessionFilter,
} from "../../../sessions/lib/agent-session-filters.js";
import { REVEAL } from "../../lib/sidebar-tree.js";

const MENU_PARTS = {
  dropdown: { Item: DropdownMenuItem, Separator: DropdownMenuSeparator },
  context: { Item: ContextMenuItem, Separator: ContextMenuSeparator },
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Agent's session filter, its New session button and its "⋯" actions menu, which its row in the tree shows on hover or keyboard focus and its popover in the collapsed sidebar's rail shows at all times.
 */
export function AgentRowActions({
  agent,
  current,
  newSessionCurrent = false,
  onNavigate,
  revealedOnHover = true,
}: {
  agent: AgentView;
  current: boolean;
  newSessionCurrent?: boolean;
  onNavigate?: (() => void) | undefined;
  revealedOnHover?: boolean;
}) {
  const startSession = useStartSession();
  const agentFilter = useAgentSessionFilter(agent.id);
  const actions = useAgentMenuActions({ agent, current, onNavigate });
  const go = (fn: () => void) => () => {
    fn();
    onNavigate?.();
  };
  return (
    <div className="flex items-center gap-0.5">
      <div
        className={cn(
          "flex items-center",
          revealedOnHover && !agentFilter && REVEAL,
        )}
      >
        <ActivityFilterMenu
          filters={agentFilter ?? defaultActivityFilters()}
          onChange={(next) => setAgentSessionFilter(agent.id, next)}
          name={`Filter sessions of ${agent.name}`}
          testId="sidebar-agent-session-filter"
          className={cn("hover:bg-background", FOCUS_RING)}
        />
      </div>
      <div
        className={cn(
          "flex items-center gap-0.5",
          revealedOnHover && REVEAL,
          revealedOnHover &&
            agentFilter &&
            "hover-capable:w-0 hover-capable:overflow-hidden hover-capable:group-hover/agent:w-auto hover-capable:group-has-[:focus-visible]/agent:w-auto hover-capable:group-has-[[data-state=open]]/agent:w-auto hover-capable:has-[[aria-current=page]]:w-auto",
        )}
      >
        <Tooltip content="New session" side="bottom">
          <button
            type="button"
            aria-label={`New session with ${agent.name}`}
            aria-current={newSessionCurrent ? "page" : undefined}
            data-testid="sidebar-agent-new-session"
            onClick={go(() => startSession(agent.id))}
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground",
              FOCUS_RING,
            )}
          >
            <Add size={16} />
          </button>
        </Tooltip>
        <RowActionsMenu
          label={`${agent.name} actions`}
          testId="sidebar-agent-menu"
          dense
        >
          <AgentMenuItems {...actions} />
        </RowActionsMenu>
      </div>
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Agent's Configure and Remove items, drawn by its row's "⋯" menu and by the menu a right click on its row opens.
 */
export function AgentMenuItems({
  onConfigure,
  onRemove,
  menu = "dropdown",
}: {
  onConfigure: () => void;
  onRemove: () => void;
  menu?: keyof typeof MENU_PARTS;
}) {
  const { Item, Separator } = MENU_PARTS[menu];
  return (
    <>
      <Item onSelect={onConfigure}>
        <Tools size={14} /> Configure
      </Item>
      <Separator />
      <Item tone="danger" onSelect={onRemove}>
        <TrashCan size={14} /> Remove
      </Item>
    </>
  );
}

function useAgentMenuActions({
  agent,
  current,
  onNavigate,
}: {
  agent: AgentView;
  current: boolean;
  onNavigate: (() => void) | undefined;
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setView = useStore((s) => s.setView);
  const confirmDelete = useConfirmDeleteAgent();
  const deleteAgent = useDeleteAgent();
  return {
    onConfigure: () => {
      navigateToSandboxHome(agent.id);
      onNavigate?.();
    },
    onRemove: () =>
      void confirmDelete(agent).then((ok) => {
        if (!ok) return;
        deleteAgent.mutate({ id: agent.id });
        if (current) setView("home");
      }),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The menu a right click on an Agent's row or on its tile in the rail opens, at the pointer: the same Configure and Remove items as its row's "⋯" menu.
 */
export function AgentContextMenu({
  agent,
  current,
  onNavigate,
  children,
}: {
  agent: AgentView;
  current: boolean;
  onNavigate: (() => void) | undefined;
  children: ReactNode;
}) {
  const actions = useAgentMenuActions({ agent, current, onNavigate });
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <AgentMenuItems menu="context" {...actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
