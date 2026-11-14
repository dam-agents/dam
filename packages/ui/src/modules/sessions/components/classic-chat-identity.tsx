import { AddComment, Branch, Document, Globe } from "@carbon/icons-react";

import { stateDotClass } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { EditableAgentIdentity } from "../../agents/components/editable-agent-identity.js";
import { SharedAgentBadge } from "../../agents/components/shared-badge.js";
import { isSharedAgent } from "../../agents/lib/agent-editors.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The left of the chat's top bar: the Agent's
 * state dot, its avatar and name, editable in place, the Shared badge of a
 * Shared Agent, and the buttons that start a new session, toggle the browser
 * and the changes beside the conversation, and open the sections on a phone.
 */
export function ClassicChatIdentity({
  agent,
  agentId,
  name,
  display,
  canOpenBrowser,
  canShowChanges,
  canStartNewSession,
  browserOpen,
  changesOpen,
  onToggleBrowser,
  onToggleChanges,
  onStartNewSession,
}: {
  agent: AgentView | null;
  agentId: string | null;
  name: string | null;
  display: AgentDisplay | null;
  canOpenBrowser: boolean;
  canShowChanges: boolean;
  canStartNewSession: boolean;
  browserOpen: boolean;
  changesOpen: boolean;
  onToggleBrowser: () => void;
  onToggleChanges: () => void;
  onStartNewSession: () => void;
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
          nameClassName="text-sm font-bold text-foreground"
        />
      ) : (
        <h1 className="text-sm font-bold text-foreground truncate">{name}</h1>
      )}
      {agent && isSharedAgent(agent) && (
        <span className="flex shrink-0 @max-[199px]:hidden">
          <SharedAgentBadge access={agent.access} />
        </span>
      )}
      <div className="ml-auto flex shrink-0">
        {canStartNewSession && agentId && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New session"
            tooltip="New session"
            onClick={onStartNewSession}
          >
            <AddComment size={16} />
          </Button>
        )}
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
        {canShowChanges && agentId && (
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
      </div>
    </div>
  );
}
