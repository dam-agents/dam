import { ArrowRight, Settings } from "@carbon/icons-react";
import { useState } from "react";

import { DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { SandboxArtifactsSection } from "../../artifacts/components/sandbox-artifacts-section.js";
import { SandboxUsageSection } from "../../metrics/components/sandbox-usage-section.js";
import { routeToPath, type SandboxSection } from "../../platform/lib/routes.js";
import { ConnectionsSection } from "../../sandboxes/components/connections-section.js";
import { SandboxChannelsSection } from "../../sandboxes/components/sandbox-channels-section.js";
import { SandboxSectionNav } from "../../sandboxes/components/sandbox-section-nav.js";
import { SandboxSkillsSection } from "../../sandboxes/components/sandbox-skills-section.js";
import { useSectionSummaries } from "../../sandboxes/hooks/use-section-summaries.js";
import { SchedulesPanel } from "../../schedules/components/schedules-panel.js";

const IN_CHAT: readonly SandboxSection[] = [
  "skills",
  "connections",
  "channels",
  "schedules",
  "artifacts",
  "usage",
];

/* UNIT_BOUNDARY_DESCRIPTION: Agent settings reached from inside a Session, without leaving
 * the chat. It mounts the same section nav and the same section bodies the Agent page uses,
 * so the two surfaces cannot drift apart. Agent Setup is the one section it leaves out: that
 * form reads the agent id the Agent page writes to the store, and a Session never writes it,
 * so Setup keeps its own page and the footer link goes there. */
export function AgentQuickSettings({ agent }: { agent: AgentView }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SandboxSection>("skills");

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Agent settings"
        tooltip="Agent settings"
        className="shrink-0"
        onClick={() => setOpen(true)}
      >
        <Settings size={16} />
      </Button>
      {open && (
        <QuickSettingsModal
          agent={agent}
          section={section}
          onSection={setSection}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function QuickSettingsModal({
  agent,
  section,
  onSection,
  onClose,
}: {
  agent: AgentView;
  section: SandboxSection;
  onSection: (section: SandboxSection) => void;
  onClose: () => void;
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const openAgentSession = useStore((s) => s.openAgentSession);
  const { summaries, warnings } = useSectionSummaries(agent);

  return (
    <Modal widthClass="w-[920px]" heightClass="h-[640px]" onClose={onClose}>
      <DialogHeader title={agent.name} subtitle="Settings" onClose={onClose} />
      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 overflow-y-auto border-r border-border p-3">
          <SandboxSectionNav
            active={section}
            onNavigate={onSection}
            summaries={summaries}
            warnings={warnings}
            include={IN_CHAT}
            className="md:static md:w-[220px]"
          />
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          <SectionBody
            agent={agent}
            section={section}
            onResumeSession={(sessionId) => {
              onClose();
              openAgentSession(agent.id, sessionId);
            }}
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end border-t border-border px-6 py-4">
        <button
          type="button"
          onClick={() => {
            onClose();
            navigateToSandboxHome(agent.id, "setup");
          }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          Agent Setup <ArrowRight size={16} />
        </button>
      </div>
    </Modal>
  );
}

function SectionBody({
  agent,
  section,
  onResumeSession,
}: {
  agent: AgentView;
  section: SandboxSection;
  onResumeSession: (sessionId: string) => void;
}) {
  switch (section) {
    case "skills":
      return <SandboxSkillsSection agent={agent} />;
    case "channels":
      return <SandboxChannelsSection agentId={agent.id} />;
    case "schedules":
      return (
        <SchedulesPanel agentId={agent.id} onResumeSession={onResumeSession} />
      );
    case "artifacts":
      return <SandboxArtifactsSection agentId={agent.id} />;
    case "usage":
      return <SandboxUsageSection agentId={agent.id} />;
    default:
      return (
        <ConnectionsSection
          agentId={agent.id}
          oauthReturnView={routeToPath({
            view: "chat",
            agent: agent.id,
          })}
        />
      );
  }
}
