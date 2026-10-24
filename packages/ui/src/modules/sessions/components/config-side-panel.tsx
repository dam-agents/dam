import { match } from "ts-pattern";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { ConnectionsSection } from "../../sandboxes/components/connections-section.js";
import { SandboxChannelsSection } from "../../sandboxes/components/sandbox-channels-section.js";
import { SandboxSkillsSection } from "../../sandboxes/components/sandbox-skills-section.js";
import { SchedulesPanel } from "../../schedules/components/schedules-panel.js";
import { justAskPrompt } from "../../schedules/lib/just-ask.js";
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
 * from the conversation, and every way out of it leads back to the
 * conversation rather than to the configuration page.
 */
export function ConfigSidePanel({
  tab,
  agent,
  agentId,
  onResumeSession,
}: {
  tab: ConfigPanelTab;
  agent: AgentView;
  agentId: string;
  onResumeSession: (sessionId: string) => void;
}) {
  const showJustAskHint = useStore((s) => s.showJustAskHint);
  const sessionId = useStore((s) => s.sessionId);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const setSidePanelFocus = useStore((s) => s.setSidePanelFocus);
  const focus = useStore((s) => s.sidePanelFocus);

  return (
    <SidebarSection title={CONFIG_PANEL_TITLES[tab]} open className="flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {match(tab)
          .with("connections", () => (
            <ConnectionsSection
              agentId={agentId}
              header={() => null}
              oauthReturnView={routeToPath({
                view: "chat",
                agent: agentId,
                ...(sessionId ? { session: sessionId } : {}),
              })}
              onGoToChannels={() => setSidePanelTab("channels")}
            />
          ))
          .with("channels", () => <SandboxChannelsSection agentId={agentId} />)
          .with("skills", () => <SandboxSkillsSection agent={agent} />)
          .with("schedules", () => (
            <SchedulesPanel
              agentId={agentId}
              header={() => null}
              onResumeSession={onResumeSession}
              focusId={focus?.tab === "schedules" ? focus.id : null}
              onFocusApplied={() => setSidePanelFocus(null)}
              onCreated={(draft) => {
                const prompt = justAskPrompt(draft);
                if (prompt) showJustAskHint({ agentId, sessionId, prompt });
              }}
            />
          ))
          .exhaustive(() => null)}
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
