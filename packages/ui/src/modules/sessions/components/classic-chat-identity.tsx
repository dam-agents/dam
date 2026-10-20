import { Branch, Document, Globe, Tools } from "@carbon/icons-react";

import { stateDotClass } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { avatarMood } from "../../agents/components/avatar/agent-avatar.js";
import { EditableAgentIdentity } from "../../agents/components/editable-agent-identity.js";
import { RuntimeMigrationBadge } from "../../agents/components/runtime-migration-badge.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The left of the chat's top bar while the
 * new-layout experiment is off: the Agent's state dot, its avatar and name,
 * editable in place, its runtime badge, and the buttons that toggle the
 * browser and the changes beside the conversation, open the sections on a
 * phone, and open the Agent's configuration.
 */
export function ClassicChatIdentity({
  agent,
  agentId,
  name,
  display,
  canOpenBrowser,
  browserOpen,
  changesOpen,
  onToggleBrowser,
  onToggleChanges,
  onConfigure,
}: {
  agent: AgentView | null;
  agentId: string | null;
  name: string | null;
  display: AgentDisplay | null;
  canOpenBrowser: boolean;
  browserOpen: boolean;
  changesOpen: boolean;
  onToggleBrowser: () => void;
  onToggleChanges: () => void;
  onConfigure: () => void;
}) {
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          agent && "hidden @max-[149px]:block",
          display ? stateDotClass[display.state] : "bg-warning",
        )}
      />
      {agent ? (
        <EditableAgentIdentity
          agent={agent}
          avatarSize={32}
          mood={avatarMood(display?.state, agent)}
          nameClassName="text-sm font-bold text-foreground"
        />
      ) : (
        <h1 className="text-sm font-bold text-foreground truncate">{name}</h1>
      )}
      {agent && (
        <span className="flex shrink-0 empty:hidden @max-[119px]:hidden">
          <RuntimeMigrationBadge
            agent={agent}
            labelClassName="@max-[279px]:sr-only"
          />
        </span>
      )}
      <div className="ml-auto flex shrink-0">
        {canOpenBrowser && agentId && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open browser"
            tooltip="Open browser"
            aria-pressed={browserOpen}
            onClick={onToggleBrowser}
          >
            <Globe size={16} />
          </Button>
        )}
        {agentId && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Show changes"
            tooltip="Show changes"
            aria-pressed={changesOpen}
            onClick={onToggleChanges}
          >
            <Branch size={16} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Files and artifacts"
          tooltip="Files and artifacts"
          data-testid="open-agent-files"
          className="md:hidden"
          onClick={() => setMobileScreen("files")}
        >
          <Document size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Configure agent"
          tooltip="Configure agent"
          className="max-md:hidden"
          onClick={onConfigure}
        >
          <Tools size={16} />
        </Button>
      </div>
    </div>
  );
}
