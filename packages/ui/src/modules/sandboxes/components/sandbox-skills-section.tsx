import type { SkillRef } from "api-server-api";
import { useCallback, useRef } from "react";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";
import { useOperableState, WakeToEditButton } from "./sandbox-wake-to-edit.js";
import { SkillsSurface } from "./skills/skills-surface.js";

/** Skills surface on the sandbox home page (#944). */
export function SandboxSkillsSection({ agent }: { agent: AgentView }) {
  // Mirror the surface's installed set into the summary's query cache so the
  // sidebar line stays live, without the summary polling the destructive
  // `skills.state` endpoint (which would clobber an in-flight toggle).
  const seededRef = useRef(false);
  const onInstalledChange = useCallback(
    (installed: SkillRef[]) => {
      // Skip the initial empty state before it has loaded, so we don't blank a
      // summary the one-shot fetch already populated.
      if (installed.length === 0 && !seededRef.current) return;
      seededRef.current = true;
      queryClient.setQueryData(
        trpc.skills.state.queryKey({ agentId: agent.id }),
        (prev) => ({
          installed,
          standalone: prev?.standalone ?? [],
          instancePublishes: prev?.instancePublishes ?? [],
        }),
      );
    },
    [agent.id],
  );

  const { operable, comingUp } = useOperableState(agent.id);

  return (
    <section className="mb-8">
      {!operable && (
        <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
          <span className="text-[13px] text-muted-foreground">
            Installing skills needs the agent running — sources can still be
            managed.
          </span>
          <WakeToEditButton
            agentId={agent.id}
            comingUp={comingUp}
            label="Start agent"
          />
        </div>
      )}
      <SkillsSurface
        agentId={agent.id}
        agentState={agent.state}
        readOnly={!operable}
        onInstalledChange={onInstalledChange}
      />
    </section>
  );
}
