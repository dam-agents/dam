import type { SkillsState } from "api-server-api";
import { useCallback } from "react";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";
import { useOperableState } from "./sandbox-wake-to-edit.js";
import { SkillsSurface } from "./skills/skills-surface.js";

export function SandboxSkillsSection({ agent }: { agent: AgentView }) {
  const onStateChange = useCallback(
    (state: SkillsState) => {
      queryClient.setQueryData(
        trpc.skills.state.queryKey({ agentId: agent.id }),
        state,
      );
    },
    [agent.id],
  );

  const { operable, comingUp } = useOperableState(agent.id);

  return (
    <section className="mb-8">
      <SkillsSurface
        agentId={agent.id}
        agentState={agent.state}
        readOnly={!operable}
        comingUp={comingUp}
        onStateChange={onStateChange}
      />
    </section>
  );
}
