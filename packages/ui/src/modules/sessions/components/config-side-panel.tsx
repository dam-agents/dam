import { match } from "ts-pattern";

import { SectionHeading } from "@/components/ui/section-heading";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { AgentModelSettingsSection } from "../../sandboxes/components/agent-config-sections.js";
import { SandboxChannelsSection } from "../../sandboxes/components/sandbox-channels-section.js";
import { SandboxProvidersSection } from "../../sandboxes/components/sandbox-providers-section.js";
import { SandboxSkillsSection } from "../../sandboxes/components/sandbox-skills-section.js";
import { ServicesPanel } from "../../sandboxes/components/services-panel.js";
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
 * panel, as four tiles by subject: Models holds the providers it runs on, the
 * settings their harnesses carry and what it spends, Services what it can reach,
 * Skills what it loads, and Automations the schedules and the channels. The
 * panel supplies the heading and the scrolling, so each section keeps one
 * implementation and one set of forms whether it is opened from the page or from
 * the conversation, and every way out of it leads back to the conversation
 * rather than to the configuration page.
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
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const sessionId = useStore((s) => s.sessionId);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const setSidePanelFocus = useStore((s) => s.setSidePanelFocus);
  const focus = useStore((s) => s.sidePanelFocus);
  return (
    <SidebarSection title={configPanelTitle(tab)} open className="flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {match(tab)
          .with("models", () => (
            <>
              <SectionHeading
                label="Providers"
                addLabel="Add provider"
                onAdd={() => navigateToSettings("providers")}
              />
              <SandboxProvidersSection agentId={agentId} header={() => null} />
              <div className="mt-10">
                <SectionHeading label="Spending" />
                <SpendingPanel agentId={agentId} />
              </div>
              <div className="mt-8">
                <AgentModelSettingsSection agentId={agentId} />
              </div>
            </>
          ))
          .with("services", () => (
            <ServicesPanel
              agent={agent}
              sessionId={sessionId}
              onGoToChannels={() => setSidePanelTab("automations")}
            />
          ))
          .with("skills", () => <SandboxSkillsSection agent={agent} panel />)
          .with("automations", () => (
            <>
              <SchedulesPanel
                agentId={agentId}
                panel
                header={() => null}
                onResumeSession={onResumeSession}
                focusId={focus?.tab === "automations" ? focus.id : null}
                onFocusApplied={() => setSidePanelFocus(null)}
                onCreated={(draft) => {
                  const prompt = justAskPrompt(draft);
                  if (prompt) showJustAskHint({ agentId, sessionId, prompt });
                }}
              />
              <div className="mt-8">
                <SectionHeading label="Channels" />
                <SandboxChannelsSection agentId={agentId} compact />
              </div>
            </>
          ))
          .exhaustive(() => null)}
      </div>
    </SidebarSection>
  );
}
