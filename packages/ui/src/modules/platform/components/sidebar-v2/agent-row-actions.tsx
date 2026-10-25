import { Renew, Tools, TrashCan } from "@carbon/icons-react";
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
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import { useDeleteAgent } from "../../../agents/api/mutations.js";
import { AgentUpdateDot } from "../../../agents/components/update-available-action.js";
import { useConfirmDeleteAgent } from "../../../agents/hooks/use-confirm-delete-agent.js";
import { useUpdateSandbox } from "../../../agents/hooks/use-update-sandbox.js";
import { ActivityFilterMenu } from "../../../home/components/activity-filter-menu.js";
import { defaultActivityFilters } from "../../../home/lib/activity-filter.js";
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
 * UNIT_BOUNDARY_DESCRIPTION: An Agent's session filter and its "⋯" actions menu, which its row in the tree shows on hover or keyboard focus and its popover in the collapsed sidebar's rail shows at all times.
 */
export function AgentRowActions({
  agent,
  current,
  onNavigate,
  revealedOnHover = true,
}: {
  agent: AgentView;
  current: boolean;
  onNavigate?: (() => void) | undefined;
  revealedOnHover?: boolean;
}) {
  const agentFilter = useAgentSessionFilter(agent.id);
  const actions = useAgentMenuActions({ agent, current, onNavigate });
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
        <span className="relative flex shrink-0">
          <RowActionsMenu
            label={`${agent.name} actions`}
            testId="sidebar-agent-menu"
            dense
          >
            <AgentMenuItems agent={agent} {...actions} />
          </RowActionsMenu>
          <AgentUpdateDot
            available={!!agent.templateUpdate}
            className="pointer-events-none absolute -right-px -top-px"
          />
        </span>
      </div>
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Agent's Configure and Remove items, drawn by its row's "⋯" menu and by the menu a right click on its row opens.
 */
export function AgentMenuItems({
  agent,
  onConfigure,
  onRemove,
  menu = "dropdown",
}: {
  agent: AgentView;
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
      {/* UNIT_BOUNDARY_DESCRIPTION: the newer sandbox an Agent can move to is
       * an action on its row (D107), not a card on the page it configures. */}
      {agent.templateUpdate && <AgentUpdateItem agent={agent} Item={Item} />}
      <Separator />
      <Item tone="danger" onSelect={onRemove}>
        <TrashCan size={14} /> Remove
      </Item>
    </>
  );
}

/* UNIT_BOUNDARY_DESCRIPTION: the update reads its own state, so a menu of an
 * Agent with nowhere to move to needs no query client at all. */
function AgentUpdateItem({
  agent,
  Item,
}: {
  agent: AgentView;
  Item: typeof DropdownMenuItem;
}) {
  const { updateOne } = useUpdateSandbox();
  return (
    <Item onSelect={() => void updateOne(agent)}>
      <Renew size={14} /> Update…
      <AgentUpdateDot available className="ml-auto" />
    </Item>
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
  onOpenChange,
  children,
}: {
  agent: AgentView;
  current: boolean;
  onNavigate: (() => void) | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  children: ReactNode;
}) {
  const actions = useAgentMenuActions({ agent, current, onNavigate });
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <AgentMenuItems agent={agent} menu="context" {...actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
