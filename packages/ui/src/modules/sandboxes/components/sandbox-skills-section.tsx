import { Locked } from "@carbon/icons-react";
import type { SkillsState } from "api-server-api";
import { useCallback, useState } from "react";

import { formatTimestamp, timeAgo } from "@/lib/format-time";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";
import { useOperableState, WakeToEditButton } from "./sandbox-wake-to-edit.js";
import { SkillsSurface } from "./skills/skills-surface.js";

/** Skills surface on the sandbox home page (#944). */
export function SandboxSkillsSection({ agent }: { agent: AgentView }) {
  // Mirror the surface's reconciled state into the summary's query cache so the
  // sidebar line stays live, without the summary polling the destructive
  // `skills.state` endpoint (which would clobber an in-flight toggle). The
  // surface holds the whole state and only reports it once loaded, so this
  // writes it wholesale — mirroring `installed` alone left the summary stale
  // after every standalone add/delete.
  // Only set while the pod is unreachable, so the list on screen came from a
  // recording rather than a live read. Kept here because the dating belongs in
  // the same sentence as the read-only notice, not stacked below it.
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
          {/* One flex item for the whole sentence: as separate children the
              row's gap would break it into columns. */}
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
