import type { AgentView } from "../../../types.js";
import { useOperableState } from "./sandbox-wake-to-edit.js";
import { SkillsSurface } from "./skills/skills-surface.js";

export function SandboxSkillsSection({ agent }: { agent: AgentView }) {
  const { operable, comingUp } = useOperableState(agent.id);

  return (
    <section className="mb-8">
      <SkillsSurface
        agentId={agent.id}
        agentState={agent.state}
        readOnly={!operable}
        comingUp={comingUp}
      />
    </section>
  );
}
