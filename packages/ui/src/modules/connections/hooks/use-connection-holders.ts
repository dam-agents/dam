import { useQueries } from "@tanstack/react-query";
import type { AgentConnections } from "api-server-api";
import { useCallback } from "react";

import { trpc } from "../../../trpc.js";
import { useAgents } from "../../agents/api/queries.js";

export type ConnectionHolders = ReadonlyMap<string, readonly string[]>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which of the viewer's own agents hold each
 * connection, by name, for the Connections page, where a row says who uses it.
 * It reads every agent's grants, the same way the delete dialog does, and is
 * null until all of them are read, so a row never shows a count that is still
 * filling in.
 */
export function useConnectionHolders(): ConnectionHolders | null {
  const agents = useAgents().data?.list;
  const combine = useCallback(
    (grants: { data?: AgentConnections; isSuccess: boolean }[]) => {
      if (!agents || !grants.every((grant) => grant.isSuccess)) return null;
      const holders = new Map<string, string[]>();
      agents.forEach((agent, i) => {
        for (const { connectionId } of grants[i]?.data?.connections ?? []) {
          holders.set(connectionId, [
            ...(holders.get(connectionId) ?? []),
            agent.name,
          ]);
        }
      });
      return holders;
    },
    [agents],
  );
  return useQueries({
    queries: (agents ?? []).map((agent) =>
      trpc.connections.getAgentConnections.queryOptions({ agentId: agent.id }),
    ),
    combine,
  });
}
