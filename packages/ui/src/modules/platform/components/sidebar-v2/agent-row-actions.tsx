import { Edit, Power, Restart, Tools, TrashCan } from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

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
import {
  useDeleteAgent,
  useSetAgentDisabled,
} from "../../../agents/api/mutations.js";
import { RenameAgentDialog } from "../../../agents/components/rename-agent-dialog.js";
import { AgentUpdateDot } from "../../../agents/components/update-available-action.js";
import { useConfirmDeleteAgent } from "../../../agents/hooks/use-confirm-delete-agent.js";
import { useRestartAgent } from "../../../agents/hooks/use-restart-agent.js";
import { useUnifiedRightToolbar } from "../../../features/hooks/use-unified-right-toolbar.js";
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
  const rightToolbar = useUnifiedRightToolbar();
  const [renaming, setRenaming] = useState(false);
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
            <AgentMenuItems
              agent={agent}
              entries={agentMenuEntries(rightToolbar)}
              onRename={() => {
                setRenaming(true);
              }}
              {...actions}
            />
          </RowActionsMenu>
          <AgentUpdateDot
            available={!!agent.templateUpdate}
            className="pointer-events-none absolute -right-px -top-px"
          />
        </span>
      </div>
      {renaming && (
        <RenameAgentDialog
          agent={agent}
          onClose={() => {
            setRenaming(false);
          }}
        />
      )}
    </div>
  );
}

export type AgentMenuEntry =
  "rename" | "configure" | "disable" | "restart" | "remove";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what an Agent's row menu offers: with the Unified
 * right toolbar experiment on, its name and avatar, its power and its removal,
 * because its configuration is one rail tile away; with the experiment off, the
 * way into its configuration page.
 */
export function agentMenuEntries(
  rightToolbar: boolean,
): readonly AgentMenuEntry[] {
  return rightToolbar
    ? ["rename", "disable", "restart", "remove"]
    : ["configure", "remove"];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Agent's row-menu items, drawn by its row's "⋯" menu and by the menu a right click on its row opens, with the rename dialog they open.
 */
export function AgentMenuItems({
  agent,
  entries,
  onConfigure,
  onRename,
  onRemove,
  onToggleDisabled,
  onRestart,
  updateAvailable,
  menu = "dropdown",
}: {
  agent: AgentView;
  entries: readonly AgentMenuEntry[];
  onConfigure: () => void;
  onRename: () => void;
  onRemove: () => void;
  onToggleDisabled: () => void;
  onRestart: () => void;
  updateAvailable: boolean;
  menu?: keyof typeof MENU_PARTS;
}) {
  const { Item, Separator } = MENU_PARTS[menu];
  return (
    <>
      {entries.includes("configure") && (
        <Item onSelect={onConfigure}>
          <Tools size={14} /> Configure
          <AgentUpdateDot available={updateAvailable} className="ml-auto" />
        </Item>
      )}
      {entries.includes("rename") && (
        <Item onSelect={onRename}>
          <Edit size={14} /> Rename
          <AgentUpdateDot available={updateAvailable} className="ml-auto" />
        </Item>
      )}
      {entries.includes("disable") && (
        <Item onSelect={onToggleDisabled}>
          <Power size={14} /> {agent.disabled ? "Enable" : "Disable"}
        </Item>
      )}
      {entries.includes("restart") && (
        <Item onSelect={onRestart}>
          <Restart size={14} /> Restart
        </Item>
      )}
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
  const showConfirm = useStore((s) => s.showConfirm);
  const confirmDelete = useConfirmDeleteAgent();
  const deleteAgent = useDeleteAgent();
  const setDisabled = useSetAgentDisabled();
  const { restart } = useRestartAgent();
  return {
    updateAvailable: !!agent.templateUpdate,
    onConfigure: () => {
      navigateToSandboxHome(agent.id);
      onNavigate?.();
    },
    onToggleDisabled: () => {
      const disable = async () => {
        if (
          !agent.disabled &&
          !(await showConfirm(
            "The agent stops now, and Slack, Telegram, schedules and SSH won't wake it until you enable it again.",
            "Disable agent?",
            { confirmLabel: "Disable" },
          ))
        )
          return;
        setDisabled.mutate({ id: agent.id, disabled: !agent.disabled });
      };
      void disable();
      onNavigate?.();
    },
    onRestart: () => {
      const ask = async () => {
        if (
          await showConfirm(
            "In-flight work is interrupted and the agent starts fresh.",
            "Restart agent?",
            { confirmLabel: "Restart" },
          )
        )
          restart(agent.id);
      };
      void ask();
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
  const rightToolbar = useUnifiedRightToolbar();
  const [renaming, setRenaming] = useState(false);
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <AgentMenuItems
          agent={agent}
          entries={agentMenuEntries(rightToolbar)}
          onRename={() => {
            setRenaming(true);
          }}
          menu="context"
          {...actions}
        />
      </ContextMenuContent>
      {renaming && (
        <RenameAgentDialog
          agent={agent}
          onClose={() => {
            setRenaming(false);
          }}
        />
      )}
    </ContextMenu>
  );
}
