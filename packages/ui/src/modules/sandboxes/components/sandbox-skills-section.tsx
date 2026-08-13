import type { SkillsState } from "api-server-api";
import { useCallback } from "react";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";
import { useOperableState } from "./sandbox-wake-to-edit.js";
import { SkillsSurface } from "./skills/skills-surface.js";

export function SandboxSkillsSection({ agent }: { agent: AgentView }) {
  // Mirror the surface's reconciled state into the summary's query cache so the
  // sidebar line stays live, without the summary polling the destructive
  // `skills.state` endpoint (which would clobber an in-flight toggle). The
  // surface holds the whole state and only reports it once loaded, so this
  // writes it wholesale — mirroring `installed` alone left the summary stale
  // after every standalone add/delete.
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
    // No read-only banner above the surface any more: while stopped the
    // surface renders its own dated notice with the Start button in it, and
    // two of those said the same thing twice.
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
