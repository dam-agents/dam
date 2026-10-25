import { match } from "ts-pattern";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { SandboxChannelsSection } from "../../sandboxes/components/sandbox-channels-section.js";
import { SandboxSkillsSection } from "../../sandboxes/components/sandbox-skills-section.js";
import { ServicesPanel } from "../../sandboxes/components/services-panel.js";
import {
  type SessionDefaultKind,
  SessionDefaultsSection,
} from "../../sandboxes/components/session-defaults-section.js";
import { SpendingPanel } from "../../sandboxes/components/spending-panel.js";
import { SchedulesPanel } from "../../schedules/components/schedules-panel.js";
import { justAskPrompt } from "../../schedules/lib/just-ask.js";
import {
  CONFIGURATION_TABS,
  type ConfigurationTab,
  type SidePanelTab,
} from "../lib/side-panel.js";
import { SIDE_PANEL_TABS } from "./side-panel-bar.js";
import { SidebarSection } from "./sidebar-section.js";

export type ConfigPanelTab = Exclude<ConfigurationTab, "environments">;

// UNIT_BOUNDARY_DESCRIPTION: each session default sits with the surface it governs — a channel thread's on Channels, a schedule's on Schedules — so the one setting is set where its effect is read. The chat default is set on the model switcher, by Set as default, and no panel shows it.
export const DEFAULTS_BY_PANEL: Partial<
  Record<ConfigPanelTab, readonly SessionDefaultKind[]>
> = {
  channels: ["channel"],
};

export function configPanelTitle(tab: SidePanelTab): string {
  return SIDE_PANEL_TABS.find((entry) => entry.tab === tab)?.label ?? tab;
}

export function isConfigPanelTab(
  tab: SidePanelTab | null,
): tab is ConfigPanelTab {
  return (
    tab !== null &&
    tab !== "environments" &&
    (CONFIGURATION_TABS as readonly SidePanelTab[]).includes(tab)
  );
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
    <SidebarSection title={configPanelTitle(tab)} open className="flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {match(tab)
          .with("agent", () => <SpendingPanel agentId={agentId} />)
          .with("services", () => (
            <ServicesPanel
              agent={agent}
              sessionId={sessionId}
              onGoToChannels={() => setSidePanelTab("channels")}
            />
          ))
          .with("channels", () => (
            <>
              <SandboxChannelsSection agentId={agentId} compact />
              <SessionDefaultsSection
                agentId={agentId}
                kinds={DEFAULTS_BY_PANEL.channels}
                label="Default model"
                hint={false}
              />
            </>
          ))
          .with("skills", () => <SandboxSkillsSection agent={agent} />)
          .with("schedules", () => (
            <>
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
            </>
          ))
          .exhaustive(() => null)}
      </div>
    </SidebarSection>
  );
}
