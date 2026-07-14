import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import { SchedulesPanel } from "../../schedules/components/schedules-panel.js";

/** Interim re-home of the existing schedules panel (redesign tracked in #943).
 *  Resuming a past run opens that session in chat, matching the inbox path. */
export function SandboxSchedulesSection({ agentId }: { agentId: string }) {
  const openAgentSession = useStore((s) => s.openAgentSession);
  return (
    <section className="mb-8">
      <SectionLabel spaced>Schedules</SectionLabel>
      <SchedulesPanel
        agentId={agentId}
        onResumeSession={(sessionId) => openAgentSession(agentId, sessionId)}
      />
    </section>
  );
}
