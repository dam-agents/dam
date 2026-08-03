import { useStore } from "../../../store.js";
import { SchedulesPanel } from "../../schedules/components/schedules-panel.js";

/** Schedules surface on the sandbox home page (#943). Resuming a past run
 *  opens that session in chat, matching the inbox path. */
export function SandboxSchedulesSection({ agentId }: { agentId: string }) {
  const openAgentSession = useStore((s) => s.openAgentSession);
  return (
    <section className="mb-8">
      <SchedulesPanel
        agentId={agentId}
        onResumeSession={(sessionId) => openAgentSession(agentId, sessionId)}
      />
    </section>
  );
}
