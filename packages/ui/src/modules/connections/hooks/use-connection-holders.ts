import { useQueries } from "@tanstack/react-query";
import type { AgentConnections, GrantToolAccess } from "api-server-api";
import { useCallback, useMemo } from "react";

import { trpc } from "../../../trpc.js";
import { useAgents } from "../../agents/api/queries.js";

export interface ConnectionHolder {
  id: string;
  name: string;
  toolAccess?: GrantToolAccess;
}

export type ConnectionHolders = ReadonlyMap<
  string,
  readonly ConnectionHolder[]
>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which agents hold each connection, by id and name, for
 * the Connections page, where a row says who uses it, with each grant's own
 * tool access where it has one. It counts the viewer's
 * own agents and the agents shared with the viewer, since the viewer can add a
 * connection to both. It reads every agent's grants and is null until all of
 * them are read, so a row never shows a count that is still filling in.
 */
export function useConnectionHolders(): ConnectionHolders | null {
  const data = useAgents().data;
  const agents = useMemo(() => data && [...data.list, ...data.shared], [data]);
  const combine = useCallback(
    (grants: { data?: AgentConnections; isSuccess: boolean }[]) => {
      if (!agents || !grants.every((grant) => grant.isSuccess)) return null;
      const holders = new Map<string, ConnectionHolder[]>();
      agents.forEach((agent, i) => {
        for (const { connectionId, toolAccess } of grants[i]?.data
          ?.connections ?? []) {
          holders.set(connectionId, [
            ...(holders.get(connectionId) ?? []),
            {
              id: agent.id,
              name: agent.name,
              ...(toolAccess && { toolAccess }),
            },
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
