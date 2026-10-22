import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useBudgetReserved } from "../../budgets/api/queries.js";
import { slotUnitOf } from "../../budgets/lib/slots.js";
import { useAgents } from "../api/queries.js";
import { resolveAgentDisplay } from "../utils/agent-resolver.js";
import { agentUsage, sandboxSubtitle } from "../utils/sandbox-subtitle.js";
import { useSlowStartIds } from "./use-slow-start.js";
import { useUpdateSandbox } from "./use-update-sandbox.js";

export function useAgentRows() {
  const { data: agentsData } = useAgents();
  const { data: budget } = useBudgetReserved();
  const restartingAgents = useStore((s) => s.restartingAgents);
  const slowStartIds = useSlowStartIds();

  const update = useUpdateSandbox();

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );

  const slotUnit = budget ? slotUnitOf(budget) : null;

  const rowProps = (agent: AgentView) => ({
    agent,
    display: resolveAgentDisplay(agent, restartingIds, slowStartIds),
    subtitle: sandboxSubtitle(agent, slotUnit),
    usage: agentUsage(agent, budget?.vm),
    updatePending: update.updatingId === agent.id,
    updateBusy: update.updatingId !== null,
    onUpdate: () => void update.updateOne(agent),
  });

  return {
    agentsData,
    initialLoaded: agentsData !== undefined,
    rowProps,
    update,
  };
}
