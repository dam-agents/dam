import { useCallback, useState } from "react";

import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";
import { useMigrateRuntimeMutation } from "../api/mutations.js";
import { agentsKeys, runtimeMigrationPlanOptions } from "../api/queries.js";
import { MigrationPlanSummary } from "../components/migration-plan-summary.js";

const AGENT_LISTS = [
  agentsKeys.listWithChannels(),
  trpc.agents.list.queryKey(),
];

export function useMigrateRuntime() {
  const showConfirm = useStore((s) => s.showConfirm);
  const migrate = useMigrateRuntimeMutation();
  // UNIT_BOUNDARY_DESCRIPTION: one mutation serves every row, and its variables name only the latest call, so a second migration would re-enable the first row's button while that request still runs. Each row's request is tracked on its own instead.
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const migrateOne = useCallback(
    async (agent: AgentView) => {
      // UNIT_BOUNDARY_DESCRIPTION: the dialog shows what the api-server would do right now, so it asks for a fresh plan rather than one cached from a hover. A plan that refuses is reported instead of asked about, since the request would be refused the same way.
      const plan = await queryClient
        .fetchQuery({ ...runtimeMigrationPlanOptions(agent.id), staleTime: 0 })
        .catch(() => null);
      if (!plan) {
        emitToast({
          kind: "error",
          message: "Couldn't load what the move would do — try again",
        });
        return;
      }
      if (!plan.allowed) {
        emitToast({
          kind: "error",
          message: `"${agent.name}" can't move to the new runtime: ${plan.refusal?.reasons.join("; ") ?? ""}`,
        });
        return;
      }
      const msg = <MigrationPlanSummary name={agent.name} plan={plan} />;
      if (
        !(await showConfirm(msg, "Move to the new runtime", {
          confirmLabel: "Migrate",
        }))
      )
        return;
      setPendingIds((ids) => new Set(ids).add(agent.id));
      // UNIT_BOUNDARY_DESCRIPTION: `mutate`'s per-call callbacks fire only for the latest call, so the first of two overlapping migrations would never be cleared; each call's own promise settles for that call alone. The row stays pending until the agents list it reads has refetched too: until then the cached agent shows no migration, and a row released early offers Migrate again for one the server has already started. The refetch joins the one the mutation's invalidation began rather than starting another. Errors are already toasted by the mutation, so the rejection carries nothing more to report.
      await migrate
        .mutateAsync({ id: agent.id })
        .then(() =>
          Promise.all(
            AGENT_LISTS.map((queryKey) =>
              queryClient.refetchQueries(
                { queryKey, type: "active" },
                { cancelRefetch: false },
              ),
            ),
          ),
        )
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
