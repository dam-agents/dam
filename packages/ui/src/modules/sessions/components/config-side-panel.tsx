import { match } from "ts-pattern";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { ChatFormSettings } from "../../a2ui/components/chat-form-settings.js";
import { EnvTab } from "../../agents/components/configure-agent/env-tab.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import { routeToPath, type SandboxSection } from "../../platform/lib/routes.js";
import { AgentModelSettingsSection } from "../../sandboxes/components/agent-config-sections.js";
import { AgentPanel } from "../../sandboxes/components/agent-panel.js";
import { ConnectionsSection } from "../../sandboxes/components/connections-section.js";
import { SandboxChannelsSection } from "../../sandboxes/components/sandbox-channels-section.js";
import { SandboxProvidersSection } from "../../sandboxes/components/sandbox-providers-section.js";
import { SECTIONS } from "../../sandboxes/components/sandbox-section-nav.js";
import { SandboxSkillsSection } from "../../sandboxes/components/sandbox-skills-section.js";
import { ConnectionAddressingSection } from "../../sandboxes/components/setup/setup-sections.js";
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

const SECTION_OF_TAB: Record<ConfigPanelTab, SandboxSection> = {
  agent: "setup",
  connections: "connections",
  channels: "channels",
  skills: "skills",
  schedules: "schedules",
  providers: "providers",
  network: "network",
  environment: "environment",
  "chat-forms": "chat-forms",
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
  display,
  agentId,
  onResumeSession,
}: {
  tab: ConfigPanelTab;
  agent: AgentView;
  display: AgentDisplay;
  agentId: string;
  onResumeSession: (sessionId: string) => void;
}) {
  const showJustAskHint = useStore((s) => s.showJustAskHint);
  const sessionId = useStore((s) => s.sessionId);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const setSidePanelFocus = useStore((s) => s.setSidePanelFocus);
  const focus = useStore((s) => s.sidePanelFocus);
  // UNIT_BOUNDARY_DESCRIPTION: the page's own description goes above every panel, because it carries the copy that stops a mistake there — env vars say they are plain text and secrets belong in Connections, and network says an unmatched request waits for approval on Home.
  const description = SECTIONS.find(
    (entry) => entry.section === SECTION_OF_TAB[tab],
  )?.description;

  return (
    <SidebarSection title={configPanelTitle(tab)} open className="flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {description && (
          <p className="mb-4 text-sm text-muted-foreground">{description}</p>
        )}
        {match(tab)
          .with("agent", () => <AgentPanel agent={agent} display={display} />)
          .with("connections", () => (
            <ConnectionsSection
              agentId={agentId}
              header={() => null}
              leading={<ConnectionAddressingSection agent={agent} />}
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
          .with("providers", () => (
            <>
              <SandboxProvidersSection agentId={agentId} header={() => null} />
              <AgentModelSettingsSection agentId={agentId} />
            </>
          ))
          .with("network", () => (
            <AgentEgressEditor agentId={agentId} header={() => null} />
          ))
          .with("environment", () => (
            <EnvTab agent={agent} header={() => null} />
          ))
          .with("chat-forms", () => <ChatFormSettings agentId={agentId} />)
          .exhaustive(() => null)}
      </div>
    </SidebarSection>
  );
}
