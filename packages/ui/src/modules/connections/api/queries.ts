import { useQuery } from "@tanstack/react-query";
import type { ConnectionView } from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useAgent, useAgentConnections } from "../../agents/api/queries.js";

export function useAppConnections(options?: {
  enabled?: boolean;
  fresh?: boolean;
}) {
  return useQuery({
    ...trpc.connections.list.queryOptions(),
    enabled: options?.enabled ?? true,
    ...(options?.fresh
      ? { staleTime: 0, refetchOnMount: "always" as const }
      : {}),
    meta: { errorToast: "Couldn't load connections" },
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The connections an Agent's page shows. On the
 * viewer's own agent that is their whole library. On a Shared Agent it is the
 * owner's connections granted to that agent, read on the owner's behalf:
 * all an Agent Editor sees of the owner's library, and never their own.
 */
export function useAgentPageConnections(agentId: string | null): {
  data: ConnectionView[] | undefined;
  isSuccess: boolean;
  isPending: boolean;
  isError: boolean;
} {
  const shared = useAgent(agentId)?.access.role === "editor";
  const own = useAppConnections({ enabled: !shared });
  const granted = useAgentConnections(shared ? agentId : null);
  if (!shared) return own;
  return {
    data: granted.data?.connections.flatMap((c) =>
      c.connection ? [c.connection] : [],
    ),
    isSuccess: granted.isSuccess,
    isPending: granted.isPending,
    isError: granted.isError,
  };
}

export function useConnectionTemplates(options?: { enabled?: boolean }) {
  return useQuery({
    ...trpc.connections.listTemplates.queryOptions(),
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load connection templates" },
  });
}

export function fetchConnection(id: string) {
  return queryClient.query({
    ...trpc.connections.get.queryOptions({ id }),
    staleTime: 0,
  });
}
