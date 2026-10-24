import { match } from "ts-pattern";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { SandboxChannelsSection } from "../../sandboxes/components/sandbox-channels-section.js";
import { SECTIONS } from "../../sandboxes/components/sandbox-section-nav.js";
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
  schedules: ["scheduled"],
};

// UNIT_BOUNDARY_DESCRIPTION: a panel shows the page's description only where it carries copy that stops a mistake; Network access keeps its rules in the editor, so no description sits above it.
const SECTION_OF_TAB: Partial<Record<ConfigPanelTab, SandboxSection>> = {
  channels: "channels",
  skills: "skills",
  schedules: "schedules",
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
  // UNIT_BOUNDARY_DESCRIPTION: the page's own description goes above every panel, because it carries the copy that stops a mistake there — env vars say they are plain text and secrets belong in Connections, and network says an unmatched request waits for approval on Home.
  const section = SECTION_OF_TAB[tab];
  const description = section
    ? SECTIONS.find((entry) => entry.section === section)?.description
    : undefined;

  return (
    <SidebarSection title={configPanelTitle(tab)} open className="flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {description && (
          <p className="mb-4 text-sm text-muted-foreground">{description}</p>
        )}
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
              <SandboxChannelsSection agentId={agentId} />
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
              <SessionDefaultsSection
                agentId={agentId}
                kinds={DEFAULTS_BY_PANEL.schedules}
                label="Default model"
                hint={false}
              />
            </>
          ))
          .with("network", () => (
            <AgentEgressEditor agentId={agentId} header={() => null} />
          ))
          .exhaustive(() => null)}
      </div>
    </SidebarSection>
  );
}
