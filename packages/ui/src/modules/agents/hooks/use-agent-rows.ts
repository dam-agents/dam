import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useBudgetReserved } from "../../budgets/api/queries.js";
import { useAgents } from "../api/queries.js";
import { resolveAgentDisplay } from "../utils/agent-resolver.js";
import { agentUsage } from "../utils/sandbox-subtitle.js";
import { useSlowStartIds } from "./use-slow-start.js";

export function useAgentRows() {
  const { data: agentsData } = useAgents();
  const { data: budget } = useBudgetReserved();
  const restartingAgents = useStore((s) => s.restartingAgents);
  const slowStartIds = useSlowStartIds();

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );

  const rowProps = (agent: AgentView) => ({
    agent,
    display: resolveAgentDisplay(agent, restartingIds, slowStartIds),
    usage: agentUsage(agent, budget?.vm),
  });

  return {
    agentsData,
    initialLoaded: agentsData !== undefined,
    rowProps,
  };
}
