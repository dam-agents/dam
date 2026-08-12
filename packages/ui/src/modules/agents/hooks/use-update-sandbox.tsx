import { useCallback } from "react";

import { getErrorMessage } from "@/lib/errors";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useUpgradeAgentMutation } from "../api/mutations.js";

/** What one sandbox's update moves, narrowed off `templateUpdate` so the apply
 *  loop needs no non-null assertion. */
interface PendingUpdate {
  id: string;
  name: string;
  toImage: string;
}

function pendingUpdates(agents: readonly AgentView[]): PendingUpdate[] {
  return agents.flatMap((agent) =>
    agent.templateUpdate
      ? [
          {
            id: agent.id,
            name: agent.name,
            toImage: agent.templateUpdate.toImage,
          },
        ]
      : [],
  );
}

/** Mirrors sizeRestartsAgent: only a sandbox that is already down applies the
 *  new image lazily, on its next start. */
function restartsToApply(agent: AgentView): boolean {
  return !(agent.state === "hibernated" || agent.overBudget);
}

/** When a batch takes effect — the same two facts the single-sandbox
 *  confirmation gives, worded per case so each sentence has a subject. Naming
 *  the groups beats "the rest", which refers to nothing when none is running. */
function batchApplyNote(restarting: number, total: number): string {
  if (restarting === 0) return "Each applies it the next time it starts.";
  if (restarting === total)
    return "They restart to apply it — in-flight work is interrupted.";
  return "Running sandboxes restart to apply it — in-flight work is interrupted. Stopped ones apply it the next time they start.";
}

/**
 * The one way a template update is applied (#3137): confirm what moves, then
 * apply. Shared by the sandbox list, the row, and the sandbox header so the
 * wording and the compare-and-swap guard can't drift between entry points.
 */
export function useUpdateSandbox() {
  const showConfirm = useStore((s) => s.showConfirm);
  const upgrade = useUpgradeAgentMutation();
  // The bulk loop reports once, in aggregate, so the per-mutation toast would
  // be one popup per failed sandbox on top of it.
  const bulkUpgrade = useUpgradeAgentMutation({ silent: true });

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

  const updateAll = useCallback(
    async (agents: readonly AgentView[]) => {
      const pending = pendingUpdates(agents);
      if (pending.length === 0) return;
      const restarting = agents.filter(
        (a) => a.templateUpdate && restartsToApply(a),
      ).length;
      const msg = (
        <>
          Update <strong className="text-foreground">{pending.length}</strong>{" "}
          sandboxes to the versions their templates now ship?{" "}
          {batchApplyNote(restarting, pending.length)}
        </>
      );
      if (!(await showConfirm(msg, "Update Sandboxes"))) return;

      // Sequential: each update rolls a pod, and a burst of concurrent rolls
      // buys nothing over a list this short.
      let updated = 0;
      const failures: string[] = [];
      for (const target of pending) {
        try {
          await bulkUpgrade.mutateAsync({
            id: target.id,
            expectedToImage: target.toImage,
          });
          updated += 1;
        } catch (err) {
          failures.push(getErrorMessage(err, `${target.name} failed`));
        }
      }

      if (failures.length === 0) {
        emitToast({
          kind: "success",
          message: `Updated ${updated} sandbox${updated === 1 ? "" : "es"}`,
        });
        return;
      }
      // Names the first reason rather than a bare count: every failed sandbox
      // keeps its own Update, so the point of the toast is why to expect it.
      emitToast({
        kind: "error",
        message: `Updated ${updated} of ${pending.length} sandboxes. ${failures.length} failed: ${failures[0]}`,
      });
    },
    [showConfirm, bulkUpgrade],
  );

  return {
    updateOne,
    updateAll,
    /** The sandbox whose single update is in flight, so one row spins rather
     *  than every row. */
    updatingId: upgrade.isPending ? upgrade.variables.id : null,
    updatingAll: bulkUpgrade.isPending,
  };
}
