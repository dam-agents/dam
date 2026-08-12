import { useCallback } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useUpgradeAgentMutation } from "../api/mutations.js";

/** Mirrors sizeRestartsAgent: only a sandbox that is already down applies the
 *  new image lazily, on its next start. */
function restartsToApply(agent: AgentView): boolean {
  return !(agent.state === "hibernated" || agent.overBudget);
}

/**
 * The one way a template update is applied (#3137): confirm what moves, then
 * apply. Shared by the sandbox row and the sandbox header so the wording and
 * the compare-and-swap guard can't drift between entry points.
 */
export function useUpdateSandbox() {
  const showConfirm = useStore((s) => s.showConfirm);
  const upgrade = useUpgradeAgentMutation();

  const updateOne = useCallback(
    async (agent: AgentView) => {
      const update = agent.templateUpdate;
      if (!update) return;
      const msg = (
        <>
          Update sandbox{" "}
          <strong className="text-foreground">"{agent.name}"</strong> to its
          template's current version? The image moves from{" "}
          <span className="font-mono text-xs">{update.fromImage}</span> to{" "}
          <span className="font-mono text-xs">{update.toImage}</span>.{" "}
          {restartsToApply(agent)
            ? "The sandbox restarts to apply it — in-flight work is interrupted."
            : "It applies when the sandbox next starts."}
        </>
      );
      if (!(await showConfirm(msg, "Update Sandbox"))) return;
      // expectedToImage binds the confirmation to the movement just shown: if
      // the template moves meanwhile, the server rejects instead of surprising.
      upgrade.mutate({ id: agent.id, expectedToImage: update.toImage });
    },
    [showConfirm, upgrade],
  );

  return {
    updateOne,
    /** The sandbox whose update is in flight, so one row spins rather than
     *  every row. */
    updatingId: upgrade.isPending ? upgrade.variables.id : null,
  };
}
