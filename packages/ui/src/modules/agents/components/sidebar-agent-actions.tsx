import {
  AddComment,
  Edit,
  Power,
  Restart,
  Tools,
  TrashCan,
} from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { Tooltip } from "@/components/ui/tooltip";

import type { AgentView } from "../../../types.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { useUnifiedRightToolbar } from "../../features/hooks/use-unified-right-toolbar.js";
import type { BindMessenger } from "../../sandboxes/components/channels/messenger-instructions.js";
import { useAgentMenuActions } from "../hooks/use-agent-menu-actions.js";
import { agentMenuEntries } from "../lib/agent-menu.js";
import { RenameAgentDialog } from "./rename-agent-dialog.js";

type Channels = { slack?: boolean; telegram?: boolean };

export function hasChannelActions(channels: Channels): boolean {
  return Boolean(channels.slack || channels.telegram);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The hover actions of an agent row in the
 * sidebar: New session and Configure agent as icons, and the Agent actions
 * kebab only when a messenger channel is available to add the agent to, so a
 * kebab never hides a single action behind an extra click.
 */
export function SidebarAgentActions({
  agent,
  current,
  channels,
  onNewSession,
  onConfigure,
  onNavigate,
  onBind,
}: {
  agent: AgentView;
  current: boolean;
  channels: Channels;
  onNewSession: () => void;
  onConfigure: () => void;
  onNavigate: () => void;
  onBind: (messenger: BindMessenger) => void;
}) {
  const rightToolbar = useUnifiedRightToolbar();
  const entries = agentMenuEntries(rightToolbar);
  const actions = useAgentMenuActions({ agent, current, onNavigate });
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <RowIconButton label="New session" onClick={onNewSession}>
        <AddComment size={14} />
      </RowIconButton>
      {entries.includes("configure") ? (
        <RowIconButton label="Configure agent" onClick={onConfigure}>
          <Tools size={14} />
        </RowIconButton>
      ) : (
        <RowActionsMenu
          label="Agent actions"
          testId="sidebar-agent-actions-menu"
          dense
          stopPropagation
        >
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Edit size={14} /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={actions.onToggleDisabled}>
            <Power size={14} /> {agent.disabled ? "Enable" : "Disable"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={actions.onRestart}>
            <Restart size={14} /> Restart
          </DropdownMenuItem>
          <DropdownMenuItem tone="danger" onSelect={actions.onRemove}>
            <TrashCan size={14} /> Remove
          </DropdownMenuItem>
        </RowActionsMenu>
      )}
      {renaming && (
        <RenameAgentDialog
          agent={agent}
          onClose={() => {
            setRenaming(false);
          }}
        />
      )}
      {hasChannelActions(channels) && (
        <RowActionsMenu
          label="Agent actions"
          testId="sidebar-agent-menu"
          dense
          stopPropagation
        >
          {channels.slack && (
            <DropdownMenuItem onSelect={() => onBind("slack")}>
              <ConnectionIcon iconSlug="slack" alt="" size={14} />
              Add to Slack channel
            </DropdownMenuItem>
          )}
          {channels.telegram && (
            <DropdownMenuItem onSelect={() => onBind("telegram")}>
              <ConnectionIcon iconSlug="telegram" alt="" size={14} />
              Add to Telegram chat
            </DropdownMenuItem>
          )}
        </RowActionsMenu>
      )}
    </>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the same New session and Configure agent icons for a Shared Agent's row, which never offers to add the agent to a messenger: only the owner binds channels.
export function SidebarSessionActions({
  onNewSession,
  onConfigure,
}: {
  onNewSession: () => void;
  onConfigure: () => void;
}) {
  return (
    <>
      <RowIconButton label="New session" onClick={onNewSession}>
        <AddComment size={14} />
      </RowIconButton>
      <RowIconButton label="Configure agent" onClick={onConfigure}>
        <Tools size={14} />
      </RowIconButton>
    </>
  );
}

function RowIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      >
        {children}
      </button>
    </Tooltip>
  );
}
