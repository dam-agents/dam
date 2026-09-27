import { useCallback, useState } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useMigrateRuntimeMutation } from "../api/mutations.js";

export function useMigrateRuntime() {
  const showConfirm = useStore((s) => s.showConfirm);
  const migrate = useMigrateRuntimeMutation();
  // UNIT_BOUNDARY_DESCRIPTION: one mutation serves every row, and its variables name only the latest call, so a second migration would re-enable the first row's button while that request still runs. Each row's request is tracked on its own instead.
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const migrateOne = useCallback(
    async (agent: AgentView) => {
      const msg = (
        <>
          Move agent <strong className="text-foreground">"{agent.name}"</strong>{" "}
          to the new sandbox runtime? The agent stops, its home directory — the
          workspace and settings — is copied over, and it restarts on the new
          runtime. It is unavailable while the copy runs, and in-flight work is
          interrupted. This cannot be undone from the UI.
        </>
      );
      if (
        !(await showConfirm(msg, "Move to the new runtime", {
          confirmLabel: "Migrate",
        }))
      )
        return;
      setPendingIds((ids) => new Set(ids).add(agent.id));
      // UNIT_BOUNDARY_DESCRIPTION: `mutate`'s per-call callbacks fire only for the latest call, so the first of two overlapping migrations would never be cleared; each call's own promise settles for that call alone. Errors are already toasted by the mutation, so the rejection carries nothing more to report.
      await migrate
        .mutateAsync({ id: agent.id })
        .catch(() => undefined)
        .finally(() =>
          setPendingIds((ids) => {
            const next = new Set(ids);
            next.delete(agent.id);
            return next;
          }),
        );
    },
    [showConfirm, migrate],
  );

  return {
    migrateOne,
    isMigrating: (id: string) => pendingIds.has(id),
  };
}
