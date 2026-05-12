import {
  ChevronDown,
  ChevronRight,
} from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { SchedulesPanel } from "../../schedules/components/schedules-panel.js";
import { ChannelsPanel } from "./channels-panel.js";
import { type McpOption, McpsPanel } from "./mcps-panel.js";
import { SkillsPanel } from "./skills-panel.js";

function Section({ title, defaultOpen = true, children }: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <Button
        variant="ghost"
        className="flex items-center gap-2 w-full justify-start rounded-none h-auto px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground hover:text-foreground/80 bg-muted"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </Button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

export function ConfigurationPanel({
  mcpOptions,
  enabledMcps,
  onToggleMcp,
  onSelectAllMcps,
  onClearAllMcps,
  hasActiveSession,
  onResumeSession,
  instanceId,
  instanceRunning,
  onOpenFile,
}: {
  mcpOptions: McpOption[];
  enabledMcps: Set<string>;
  onToggleMcp: (hostname: string) => void;
  onSelectAllMcps: () => void;
  onClearAllMcps: () => void;
  hasActiveSession: boolean;
  /** Called when the user clicks a past run under a schedule card. */
  onResumeSession?: (sessionId: string) => void;
  instanceId: string | null;
  instanceRunning: boolean;
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

      <Section title="MCP Servers">
        <McpsPanel
          options={mcpOptions}
          enabled={enabledMcps}
          onToggle={onToggleMcp}
          onSelectAll={onSelectAllMcps}
          onClearAll={onClearAllMcps}
          hasActiveSession={hasActiveSession}
        />
      </Section>

      <Section title="Skills">
        <SkillsPanel instanceId={instanceId} isRunning={instanceRunning} onOpenFile={onOpenFile} />
      </Section>
    </div>
  );
}
