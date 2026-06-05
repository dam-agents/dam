import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { AgentState } from "../../../types.js";
import { SchedulesPanel } from "../../schedules/components/schedules-panel.js";
import { ChannelsPanel } from "./channels-panel.js";
import { SkillsPanel } from "./skills-panel.js";

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <button
        className="flex items-center gap-2 w-full px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted hover:text-text-secondary transition-colors bg-surface-raised"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="border-t border-border-light">{children}</div>}
    </div>
  );
}

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
        <SchedulesPanel onResumeSession={onResumeSession} />
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
    </div>
  );
}
