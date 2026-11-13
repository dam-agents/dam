import {
  Activity,
  Branch,
  type CarbonIconType,
  Diagram,
  Document,
  Folder,
  Globe,
  Tools,
} from "@carbon/icons-react";
import type { ReactNode } from "react";

import { stateDotClass } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { SharedAgentBadge } from "../../agents/components/shared-badge.js";
import { isSharedAgent } from "../../agents/lib/agent-editors.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { useChatSections } from "../hooks/use-chat-sections.js";
import type { SidebarPanelId } from "../lib/sidebar-panels.js";
import { AgentSettingsButton } from "./agent-settings-button.js";

/* UNIT_BOUNDARY_DESCRIPTION: every icon button of the top bar, toggle or not, is this one 8×8 rounded square with muted ink, so they share one size and one alignment. */
const TOP_BAR_ICON =
  "h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground";
/* UNIT_BOUNDARY_DESCRIPTION: a toggle adds the design's open state: the neutral muted square of a selected row, never the accent. */
const TOGGLE = `${TOP_BAR_ICON} aria-pressed:bg-muted aria-pressed:text-foreground`;

const SECTION_TOGGLES: Record<
  SidebarPanelId,
  { label: string; Icon: CarbonIconType }
> = {
  files: { label: "Show files", Icon: Folder },
  artifacts: { label: "Show artifacts", Icon: Diagram },
  processes: { label: "Show processes", Icon: Activity },
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: The left of the chat's top bar, as the design
 * draws it: the Agent's state dot, its avatar and name, which open its
 * settings over the chat, the Shared badge of a Shared Agent, and right after
 * the name the toggles of the sections beside the conversation (Files,
 * Artifacts, and Processes when they are on) on a desktop, and at the end
 * of the same area, where main has them, the browser, changes and settings
 * buttons. The buttons never shrink: on a narrow top bar the name truncates
 * first, so no button is cut off.
 */
export function ClassicChatIdentity({
  agent,
  name,
  display,
  onConfigure,
  processesEnabled = false,
  actions,
}: {
  agent: AgentView | null;
  name: string | null;
  display: AgentDisplay | null;
  onConfigure: () => void;
  processesEnabled?: boolean;
  /** UNIT_BOUNDARY_DESCRIPTION: the top bar's buttons, drawn in the same row as the section toggles, with the same spacing, so every icon sits at the same place whether a section is open or not. */
  actions?: ReactNode;
}) {
  const sections = useChatSections(processesEnabled);
  return (
    <div className="flex min-w-min flex-1 items-center gap-3">
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          agent && "hidden @max-[149px]:block",
          display ? stateDotClass[display.state] : "bg-warning",
        )}
      />
      {agent ? (
        <AgentSettingsButton agent={agent} onClick={onConfigure} />
      ) : (
        <h1 className="text-sm font-bold text-foreground truncate">{name}</h1>
      )}
      {agent && isSharedAgent(agent) && (
        <span className="flex shrink-0 @max-[199px]:hidden">
          <SharedAgentBadge access={agent.access} />
        </span>
      )}
      <div className="flex shrink-0 items-center gap-2">
        {sections.map((section) => {
          const toggle = SECTION_TOGGLES[section.id];
          return (
            <Button
              key={section.id}
              variant="ghost"
              size="icon-sm"
              aria-label={toggle.label}
              tooltip={toggle.label}
              aria-pressed={section.open}
              data-testid={`toggle-${section.id}-section`}
              className={cn(TOGGLE, "max-md:hidden")}
              onClick={() => section.setOpen(!section.open)}
            >
              <toggle.Icon size={16} />
            </Button>
          );
        })}
        {actions}
      </div>
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The chat's top-bar buttons after the Agent's
 * name, as on main: toggle the browser and the changes beside the
 * conversation, open the sections on a phone, and the wrench, which opens the
 * same settings modal as the Agent's name.
 */
export function ClassicChatToolbar({
  agentId,
  canOpenBrowser,
  canShowChanges,
  browserOpen,
  changesOpen,
  onToggleBrowser,
  onToggleChanges,
  onConfigure,
}: {
  agentId: string | null;
  canOpenBrowser: boolean;
  canShowChanges: boolean;
  browserOpen: boolean;
  changesOpen: boolean;
  onToggleBrowser: () => void;
  onToggleChanges: () => void;
  onConfigure: () => void;
}) {
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  return (
    <>
      {canOpenBrowser && agentId && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open browser"
          tooltip="Open browser"
          aria-pressed={browserOpen}
          className={TOGGLE}
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
          className={TOGGLE}
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
        className={cn(TOP_BAR_ICON, "md:hidden")}
        onClick={() => setMobileScreen("files")}
      >
        <Document size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Agent settings"
        tooltip="Agent settings"
        className={cn(TOP_BAR_ICON, "max-md:hidden")}
        onClick={onConfigure}
      >
        <Tools size={16} />
      </Button>
    </>
  );
}
