import { AddComment, Settings } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { Tooltip } from "@/components/ui/tooltip";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import type { BindMessenger } from "../../sandboxes/components/channels/messenger-instructions.js";

type Channels = { slack?: boolean; telegram?: boolean };

/** Whether the row has messenger channels for the Agent actions kebab. */
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
  channels,
  onNewSession,
  onConfigure,
  onBind,
}: {
  channels: Channels;
  onNewSession: () => void;
  onConfigure: () => void;
  onBind: (messenger: BindMessenger) => void;
}) {
  return (
    <>
      <RowIconButton label="New session" onClick={onNewSession}>
        <AddComment size={14} />
      </RowIconButton>
      <RowIconButton label="Configure agent" onClick={onConfigure}>
        <Settings size={14} />
      </RowIconButton>
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
