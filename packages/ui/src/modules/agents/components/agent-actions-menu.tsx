import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";

import type { AgentView } from "../../../types.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import type { AgentDisplay } from "../utils/agent-resolver.js";
import { FreeUpComputeItems } from "./power-menu-items.js";

interface Props {
  agent: AgentView;
  display: AgentDisplay;
  deletePending: boolean;
  configureLabel: string;
  onConfigure: () => void;
  onWake: () => void;
  onRestart: () => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
  onAddToChannel?: (messenger: "slack" | "telegram") => void;
  messengers?: { slack?: boolean; telegram?: boolean };
  dense?: boolean;
  className?: string;
}

export function AgentActionsMenu({
  agent,
  display,
  deletePending,
  configureLabel,
  onConfigure,
  onWake,
  onRestart,
  onPause,
  onStop,
  onDelete,
  onAddToChannel,
  messengers = {},
  dense,
  className,
}: Props) {
  return (
    <RowActionsMenu
      label="Agent actions"
      dense={dense}
      className={className}
      stopPropagation
    >
      <DropdownMenuItem onSelect={onConfigure}>
        {configureLabel}
      </DropdownMenuItem>
      {onAddToChannel && (messengers.slack || messengers.telegram) && (
        <>
          <DropdownMenuSeparator />
          {messengers.slack && (
            <DropdownMenuItem onSelect={() => onAddToChannel("slack")}>
              <ConnectionIcon iconSlug="slack" alt="" size={16} />
              Add to Slack channel
            </DropdownMenuItem>
          )}
          {messengers.telegram && (
            <DropdownMenuItem onSelect={() => onAddToChannel("telegram")}>
              <ConnectionIcon iconSlug="telegram" alt="" size={16} />
              Add to Telegram chat
            </DropdownMenuItem>
          )}
        </>
      )}
      <DropdownMenuSeparator />
      {display.state === "running" && (
        <FreeUpComputeItems agent={agent} onPause={onPause} onStop={onStop} />
      )}
      {display.powerAction === "start" ? (
        <DropdownMenuItem onSelect={onWake}>
          {display.state === "over_budget" ? "Start" : "Wake"}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          disabled={display.powerAction === null}
          onSelect={onRestart}
        >
          Restart
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        tone="danger"
        disabled={deletePending}
        onSelect={onDelete}
      >
        Delete agent
      </DropdownMenuItem>
    </RowActionsMenu>
  );
}
