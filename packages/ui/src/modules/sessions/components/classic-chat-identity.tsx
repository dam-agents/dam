import { Branch, Document, Folder, Globe, Tools } from "@carbon/icons-react";

import { stateDotClass } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { avatarMood } from "../../agents/components/avatar/agent-avatar.js";
import { SharedAgentBadge } from "../../agents/components/shared-badge.js";
import { isSharedAgent } from "../../agents/lib/agent-editors.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { ArtifactIcon } from "../../artifacts/lib/artifact-icon.js";
import { AgentSettingsButton } from "./agent-settings-button.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The left of the chat's top bar: the Agent's
 * state dot, its avatar and name, which open its settings over the chat, the
 * Shared badge of a Shared Agent, and the buttons that toggle the browser and the changes beside
 * the conversation, toggle the Files and Artifacts sections on a desktop, open
 * the sections on a phone, and open the Agent's configuration.
 */
export function ClassicChatIdentity({
  agent,
  agentId,
  name,
  display,
  canOpenBrowser,
  canShowChanges,
  browserOpen,
  changesOpen,
  onToggleBrowser,
  onToggleChanges,
  onConfigure,
  onOpenSettings,
}: {
  agent: AgentView | null;
  agentId: string | null;
  name: string | null;
  display: AgentDisplay | null;
  canOpenBrowser: boolean;
  canShowChanges: boolean;
  browserOpen: boolean;
  changesOpen: boolean;
  onToggleBrowser: () => void;
  onToggleChanges: () => void;
  onConfigure: () => void;
  onOpenSettings: () => void;
}) {
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const filesOpen = useStore((s) => s.filesSectionOpen);
  const setFilesOpen = useStore((s) => s.setFilesSectionOpen);
  const artifactsOpen = useStore((s) => s.artifactsSectionOpen);
  const setArtifactsOpen = useStore((s) => s.setArtifactsSectionOpen);
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
        <AgentSettingsButton
          agent={agent}
          mood={avatarMood(display?.state, agent)}
          onClick={onOpenSettings}
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
          aria-label="Show files"
          tooltip="Show files"
          aria-pressed={filesOpen}
          data-testid="toggle-files-section"
          className="max-md:hidden"
          onClick={() => setFilesOpen(!filesOpen)}
        >
          <Folder size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Show artifacts"
          tooltip="Show artifacts"
          aria-pressed={artifactsOpen}
          data-testid="toggle-artifacts-section"
          className="max-md:hidden"
          onClick={() => setArtifactsOpen(!artifactsOpen)}
        >
          <ArtifactIcon size={16} />
        </Button>
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
