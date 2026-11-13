import type { AgentView } from "../../../types.js";
import { SharedAgentBadge } from "../../agents/components/shared-badge.js";
import { isSharedAgent } from "../../agents/lib/agent-editors.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { AgentMenu, type AgentMenuToggle } from "./agent-menu.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The start of the chat's header, as the design's
 * chat refresh draws it: the agent menu on the Agent's avatar and name, and
 * the Shared badge of a Shared Agent. Before the Agent loads, its name alone.
 */
export function ClassicChatIdentity({
  agent,
  name,
  display,
  artifacts,
  files,
  browser,
  processes,
  changes,
  onOpenSettings,
}: {
  agent: AgentView | null;
  name: string | null;
  display: AgentDisplay | null;
  artifacts: AgentMenuToggle;
  files: AgentMenuToggle;
  browser: AgentMenuToggle | null;
  processes: AgentMenuToggle | null;
  changes: (() => void) | null;
  onOpenSettings: (section: SandboxSection) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {agent ? (
        <AgentMenu
          agent={agent}
          display={display}
          artifacts={artifacts}
          files={files}
          browser={browser}
          processes={processes}
          changes={changes}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <h1 className="truncate px-1 text-sm font-semibold text-foreground">
          {name}
        </h1>
      )}
      {agent && isSharedAgent(agent) && (
        <span className="flex shrink-0">
          <SharedAgentBadge access={agent.access} />
        </span>
      )}
    </div>
  );
}
