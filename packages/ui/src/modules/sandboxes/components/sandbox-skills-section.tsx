import { Locked } from "@carbon/icons-react";
import type { SkillsState } from "api-server-api";
import { useCallback, useState } from "react";

import { formatTimestamp, timeAgo } from "@/lib/format-time";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";
import { useOperableState, WakeToEditButton } from "./sandbox-wake-to-edit.js";
import { SkillsSurface } from "./skills/skills-surface.js";

export function SandboxSkillsSection({ agent }: { agent: AgentView }) {
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);

  const onStateChange = useCallback(
    (state: SkillsState) => {
      queryClient.setQueryData(
        trpc.skills.state.queryKey({ agentId: agent.id }),
        state,
      );
      setSnapshotAt(state.standaloneSnapshot?.capturedAt ?? null);
    },
    [agent.id],
  );

  const { operable, comingUp } = useOperableState(agent.id);

  return (
    <section className="mb-8">
      {!operable && (
        <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
          {}
          <span className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Locked size={14} className="mt-0.5 shrink-0" />
            <span>
              Skills are read-only while the agent is stopped
              {snapshotAt && (
                <>
                  {" — this list is what it had "}
                  <span title={formatTimestamp(snapshotAt)}>
                    {timeAgo(snapshotAt)}
                  </span>
                  , when it last ran
                </>
              )}
            </span>
          </span>
          <WakeToEditButton agentId={agent.id} comingUp={comingUp} />
        </div>
      )}
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
