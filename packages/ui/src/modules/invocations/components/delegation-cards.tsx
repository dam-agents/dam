import type { DelegationNode } from "api-server-api";
import { useMemo } from "react";

import { useAgents } from "../../agents/api/queries.js";
import { useInstallCapabilities } from "../../features/api/queries.js";
import { useInvocationTurns } from "../api/queries.js";
import { type DelegationTarget, flattenIds } from "../lib/delegation-state.js";
import { DelegationCard } from "./delegation-card.js";

interface Props {
  nodes: readonly DelegationNode[];
  driverAgentId: string;
}

export function DelegationCards({ nodes, driverAgentId }: Props) {
  const telemetryEnabled =
    useInstallCapabilities().data?.telemetryBackend ?? false;
  const { data: agents } = useAgents();
  const allIds = useMemo(() => flattenIds(nodes), [nodes]);
  const { data: telemetry } = useInvocationTurns(
    driverAgentId,
    allIds,
    telemetryEnabled,
    nodes,
  );
  const turns = telemetry?.available ? telemetry.turns : undefined;
  const targets = useMemo(
    () =>
      new Map<string, DelegationTarget>(
        [...(agents?.list ?? []), ...(agents?.shared ?? [])].map((a) => [
          a.id,
          a,
        ]),
      ),
    [agents],
  );

  return (
    <>
      {nodes.map((node) => (
        <DelegationCard
          key={node.id}
          node={node}
          driverAgentId={driverAgentId}
          targets={targets}
          turns={turns}
        />
      ))}
    </>
  );
}
