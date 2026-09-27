import { useCallback } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useMigrateRuntimeMutation } from "../api/mutations.js";

export function useMigrateRuntime() {
  const showConfirm = useStore((s) => s.showConfirm);
  const migrate = useMigrateRuntimeMutation();

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
      migrate.mutate({ id: agent.id });
    },
    [showConfirm, migrate],
  );

  return {
    migrateOne,
    migratingId: migrate.isPending ? migrate.variables.id : null,
  };
}
