import {
  Activity,
  Branch,
  Checkmark,
  DataCategorical,
  Edit,
  Folder,
  Globe,
  Settings,
  Share,
} from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import { stateDotClass } from "@/components/status-indicator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { RenameAgentDialog } from "../../agents/components/rename-agent-dialog.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import type { SandboxSection } from "../../platform/lib/routes.js";

/** UNIT_BOUNDARY_DESCRIPTION: an item of the agent menu that opens or closes something beside the conversation, with whether it shows now; absent when the Agent has nothing for it. */
export interface AgentMenuToggle {
  open: boolean;
  onToggle: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The agent's avatar, name and state dot at the
 * start of the chat's header, as one button that opens the agent menu, as the
 * design's chat refresh draws it: Rename, Artifacts and File tree (checked
 * while open), Git Changes, Add editors and Agent settings. The design has no
 * other way to open the browser or the processes, so they are items of the
 * same menu, checked the same way, for an Agent that has them.
 */
export function AgentMenu({
  agent,
  display,
  artifacts,
  files,
  browser,
  processes,
  changes,
  onOpenSettings,
}: {
  agent: AgentView;
  display: AgentDisplay | null;
  artifacts: AgentMenuToggle;
  files: AgentMenuToggle;
  browser: AgentMenuToggle | null;
  processes: AgentMenuToggle | null;
  changes: (() => void) | null;
  onOpenSettings: (section: SandboxSection) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      {renaming && (
        <RenameAgentDialog agent={agent} onClose={() => setRenaming(false)} />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${agent.name} menu`}
            data-testid="chat-agent-identity"
            className="group flex min-w-0 items-center gap-2 rounded-lg py-1 pr-3 pl-1 transition-colors hover:bg-muted"
          >
            <AgentAvatar
              name={agent.name}
              avatar={agent.avatar}
              size={24}
              className="shrink-0"
            />
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {agent.name}
            </span>
            {display && (
              <span
                aria-hidden
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  stateDotClass[display.state],
                )}
              />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" data-testid="agent-menu">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Edit size={13} /> Rename
          </DropdownMenuItem>
          <ToggleItem icon={<DataCategorical size={13} />} toggle={artifacts}>
            Artifacts
          </ToggleItem>
          <ToggleItem icon={<Folder size={13} />} toggle={files}>
            File tree
          </ToggleItem>
          {browser && (
            <ToggleItem icon={<Globe size={13} />} toggle={browser}>
              Browser
            </ToggleItem>
          )}
          {processes && (
            <ToggleItem icon={<Activity size={13} />} toggle={processes}>
              Processes
            </ToggleItem>
          )}
          {changes && (
            <DropdownMenuItem onSelect={changes}>
              <Branch size={13} /> Git Changes
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onOpenSettings("people")}>
            <Share size={13} /> Add editors
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onOpenSettings("setup")}>
            <Settings size={13} /> Agent settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function ToggleItem({
  icon,
  toggle,
  children,
}: {
  icon: ReactNode;
  toggle: AgentMenuToggle;
  children: ReactNode;
}) {
  return (
    <DropdownMenuItem onSelect={toggle.onToggle}>
      {icon}
      <span className="flex-1">{children}</span>
      {toggle.open && (
        <Checkmark
          size={16}
          className="text-foreground"
          aria-label="Shown"
          data-testid="agent-menu-check"
        />
      )}
    </DropdownMenuItem>
  );
}
