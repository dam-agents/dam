import { useCallback } from "react";

import { getErrorMessage } from "@/lib/errors";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useUpgradeAgentMutation } from "../api/mutations.js";
import { ReleaseNotesLink } from "../components/release-notes-link.js";
import { releaseNotesUrl } from "./use-release-notes-url.js";

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

function restartsToApply(agent: AgentView): boolean {
  return !(agent.state === "hibernated" || agent.overBudget);
}

function batchSubject(total: number): string {
  return total === 1 ? "sandbox" : "sandboxes";
}

function byTargetImage(
  pending: readonly PendingUpdate[],
): Array<{ image: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of pending)
    counts.set(p.toImage, (counts.get(p.toImage) ?? 0) + 1);
  return [...counts].map(([image, count]) => ({ image, count }));
}

function batchApplyNote(restarting: number, total: number): string {
  if (restarting === 0) return "Each applies it the next time it starts.";
  if (restarting === total)
    return "They restart to apply it — in-flight work is interrupted.";
  return "Running sandboxes restart to apply it — in-flight work is interrupted. Stopped ones apply it the next time they start.";
}

export function useUpdateSandbox() {
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: templates } = useTemplates();
  const upgrade = useUpgradeAgentMutation();
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
          <ReleaseNotesLink
            href={releaseNotesUrl(templates, agent.templateId)}
            className="mt-2 flex w-fit"
          />
        </>
      );
      if (!(await showConfirm(msg, "Update Sandbox"))) return;
      upgrade.mutate({ id: agent.id, expectedToImage: update.toImage });
    },
    [showConfirm, upgrade, templates],
  );

  const updateAll = useCallback(
    async (agents: readonly AgentView[]) => {
      const pending = pendingUpdates(agents);
      if (pending.length === 0) return;
      const restarting = agents.filter(
        (a) => a.templateUpdate && restartsToApply(a),
      ).length;
      const targets = byTargetImage(pending);
      const msg = (
        <>
          Update <strong className="text-foreground">{pending.length}</strong>{" "}
          {batchSubject(pending.length)}{" "}
          {targets.length === 1 ? (
            <>
              to <span className="font-mono text-xs">{targets[0]!.image}</span>
              ?{" "}
            </>
          ) : (
            <>
              to the versions their templates now ship?
              <ul className="my-2 flex flex-col gap-1">
                {targets.map(({ image, count }) => (
                  <li key={image} className="text-sm">
                    <span className="font-mono text-xs">{image}</span> — {count}{" "}
                    {count === 1 ? "sandbox" : "sandboxes"}
                  </li>
                ))}
              </ul>
            </>
          )}
          {batchApplyNote(restarting, pending.length)}
        </>
      );
      if (!(await showConfirm(msg, "Update Sandboxes"))) return;

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
          failures.push(`${target.name}: ${getErrorMessage(err, "failed")}`);
        }
      }

      if (failures.length === 0) {
        emitToast({
          kind: "success",
          message: `Updated ${updated} sandbox${updated === 1 ? "" : "es"}`,
        });
        return;
      }
      emitToast({
        kind: "error",
        message: `Updated ${updated} of ${pending.length} sandboxes. ${failures.length} failed — ${failures.join("; ")}`,
      });
    },
    [showConfirm, bulkUpgrade],
  );

  return {
    updateOne,
    updateAll,
    updatingId: upgrade.isPending ? upgrade.variables.id : null,
    updatingAll: bulkUpgrade.isPending,
  };
}
