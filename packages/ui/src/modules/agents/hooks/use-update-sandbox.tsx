import { useCallback } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useUpgradeAgentMutation } from "../api/mutations.js";
import { useAgent } from "../api/queries.js";
import { updateDialogMessage } from "../lib/update-copy.js";

export function useUpdateSandbox() {
  const showConfirm = useStore((s) => s.showConfirm);
  const upgrade = useUpgradeAgentMutation();

  const updateOne = useCallback(
    async (agent: AgentView) => {
      const update = agent.templateUpdate;
      if (!update) return;
      if (
        !(await showConfirm(updateDialogMessage(), "Update agent?", {
          confirmLabel: "Update",
        }))
      )
        return;
      upgrade.mutate({ id: agent.id, expectedToImage: update.toImage });
    },
    [showConfirm, upgrade],
  );

  return {
    updateOne,
    updatingId: upgrade.isPending ? upgrade.variables.id : null,
  };
}

export function useAgentUpdateAction(agentId: string | null) {
  const agent = useAgent(agentId) ?? undefined;
  const { updateOne, updatingId } = useUpdateSandbox();
  return {
    agent,
    update: agent?.templateUpdate ?? null,
    updateOne,
    pending: agent !== undefined && updatingId === agent.id,
  };
}
