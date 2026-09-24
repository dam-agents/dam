import type { DelegationNode } from "api-server-api";
import { useMemo } from "react";

import type { AgentState } from "../../../types.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useFeatures } from "../../features/api/queries.js";
import { useInvocationTurns } from "../api/queries.js";
import { flattenIds, hasRunning } from "../lib/delegation-state.js";
import { DelegationCard } from "./delegation-card.js";

interface Props {
  nodes: readonly DelegationNode[];
  driverAgentId: string;
}

export function DelegationCards({ nodes, driverAgentId }: Props) {
  const telemetryEnabled = useFeatures().data?.["agent-telemetry"] ?? false;
  const agents = useAgentsList();
  const allIds = useMemo(() => flattenIds(nodes), [nodes]);
  const { data: telemetry } = useInvocationTurns(
    driverAgentId,
    allIds,
    telemetryEnabled,
    hasRunning(nodes),
  );
  const turns = telemetry?.available ? telemetry.turns : undefined;
  const agentStates = useMemo(
    () => new Map<string, AgentState>(agents.map((a) => [a.id, a.state])),
    [agents],
  );

  return (
    <>
      {nodes.map((node) => (
        <DelegationCard
          key={node.id}
          node={node}
          driverAgentId={driverAgentId}
          agentStates={agentStates}
          turns={turns}
        />
      ))}
    </>
  );
}
