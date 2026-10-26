import type { AgentView } from "../../../types.js";
import { useOperableState } from "../../agents/hooks/use-operable-state.js";
import { holds } from "../../agents/lib/agent-permissions.js";
import { SkillsSurface } from "./skills/skills-surface.js";

export function SandboxSkillsSection({
  agent,
  panel = false,
}: {
  agent: AgentView;
  panel?: boolean;
}) {
  const { operable, comingUp } = useOperableState(agent.id);

  return (
    <section className="mb-8">
      <SkillsSurface
        agentId={agent.id}
        agentState={agent.state}
        agentDisabled={agent.disabled}
        readOnly={!operable}
        comingUp={comingUp}
        managesLibrary={holds(agent.access, "skillSources")}
        canPublish={holds(agent.access, "skillPublish")}
        panel={panel}
      />
    </section>
  );
}
