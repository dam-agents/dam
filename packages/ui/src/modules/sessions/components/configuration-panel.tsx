import type { AgentState } from "../../../types.js";
import { SchedulesPanel } from "../../schedules/components/schedules-panel.js";
import { ChannelsPanel } from "./channels-panel.js";
import { Section } from "./config-section.js";
import { ModelSettingsPanel } from "./model-settings-panel.js";
import { SkillsPanel } from "./skills-panel.js";

export function ConfigurationPanel({
  onResumeSession,
  agentId,
  agentState,
  onOpenFile,
}: {
  /** Called when the user clicks a past run under a schedule card. */
  onResumeSession?: (sessionId: string) => void;
  agentId: string | null;
  agentState: AgentState | undefined;
  onOpenFile?: (path: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <Section title="Schedules">
        <SchedulesPanel agentId={agentId} onResumeSession={onResumeSession} />
      </Section>

      <Section title="Channels">
        <ChannelsPanel />
      </Section>

      <Section title="Skills">
        <SkillsPanel
          agentId={agentId}
          agentState={agentState}
          onOpenFile={onOpenFile}
        />
      </Section>

      <ModelSettingsPanel agentId={agentId} />
    </div>
  );
}
