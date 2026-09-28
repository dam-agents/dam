import { useCallback, useState } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  useAbortRuntimeMigrationMutation,
  useRetryRuntimeMigrationMutation,
} from "../api/mutations.js";
import { type InFlightIds, whileInFlight } from "../utils/runtime-migration.js";

// UNIT_BOUNDARY_DESCRIPTION: the two ways out of a runtime migration that has not finished: Abort, which takes the agent back to its previous runtime and is confirmed first since it discards the copy, and Retry, which starts a failed move over. Both are refused by the api-server once the agent has started on the new runtime, and that refusal is toasted like any other. One mutation of each serves every row and its variables name only the latest call, so each row's request is tracked on its own, from its start to its own settling.
export function useRuntimeMigrationControls() {
  const showConfirm = useStore((s) => s.showConfirm);
  const abort = useAbortRuntimeMigrationMutation();
  const retry = useRetryRuntimeMigrationMutation();
  const [busyIds, setBusyIds] = useState<InFlightIds>(() => new Map());

  const abortOne = useCallback(
    async (agent: AgentView) => {
      const msg = (
        <>
          Stop moving agent{" "}
          <strong className="text-foreground">"{agent.name}"</strong> to the new
          sandbox runtime? The copy made so far is discarded and the agent
          restarts on its previous runtime with its home directory as it was.
        </>
      );
      if (
        !(await showConfirm(msg, "Undo the move", {
          confirmLabel: "Abort",
        }))
      )
        return;
      await whileInFlight(agent.id, setBusyIds, () =>
        abort.mutateAsync({ id: agent.id }),
      );
    },
    [showConfirm, abort],
  );

  const retryOne = useCallback(
    async (agent: AgentView) => {
      await whileInFlight(agent.id, setBusyIds, () =>
        retry.mutateAsync({ id: agent.id }),
      );
    },
    [retry],
  );

  return {
    abortOne,
    retryOne,
    isBusy: (id: string) => (busyIds.get(id) ?? 0) > 0,
  };
}
