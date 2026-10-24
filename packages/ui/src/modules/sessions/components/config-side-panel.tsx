import type { AgentView } from "../../../types.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { ConnectionsSection } from "../../sandboxes/components/connections-section.js";
import { SandboxChannelsSection } from "../../sandboxes/components/sandbox-channels-section.js";
import { SandboxSkillsSection } from "../../sandboxes/components/sandbox-skills-section.js";
import { SchedulesPanel } from "../../schedules/components/schedules-panel.js";
import type { SidePanelTab } from "../lib/side-panel.js";
import { SidebarSection } from "./sidebar-section.js";

export type ConfigPanelTab = Extract<
  SidePanelTab,
  "connections" | "channels" | "skills" | "schedules"
>;

export function isConfigPanelTab(
  tab: SidePanelTab | null,
): tab is ConfigPanelTab {
  return tab !== null && tab in CONFIG_PANEL_TITLES;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an Agent's configuration, in the chat's side
 * panel, from the sections its configuration page already renders. The panel
 * supplies the heading and the scrolling, so each section keeps one
 * implementation and one set of forms whether it is opened from the page or
 * from the conversation.
 */
export function ConfigSidePanel({
  tab,
  agent,
  agentId,
  focusScheduleId,
  onResumeSession,
}: {
  tab: ConfigPanelTab;
  agent: AgentView;
  agentId: string;
  focusScheduleId: string | null;
  onResumeSession: (sessionId: string) => void;
}) {
  return (
    <SidebarSection title={CONFIG_PANEL_TITLES[tab]} open className="flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {tab === "connections" ? (
          <ConnectionsSection
            agentId={agentId}
            header={() => null}
            oauthReturnView={routeToPath({
              view: "sandbox-home",
              agentId,
              sandboxSection: "connections",
            })}
          />
        ) : tab === "channels" ? (
          <SandboxChannelsSection agentId={agentId} />
        ) : tab === "skills" ? (
          <SandboxSkillsSection agent={agent} />
        ) : (
          <SchedulesPanel
            agentId={agentId}
            header={() => null}
            onResumeSession={onResumeSession}
            focusId={focusScheduleId}
          />
        )}
      </div>
    </SidebarSection>
  );
}

export const CONFIG_PANEL_TITLES: Record<ConfigPanelTab, string> = {
  connections: "Connections",
  channels: "Channels",
  skills: "Skills",
  schedules: "Schedules",
};
