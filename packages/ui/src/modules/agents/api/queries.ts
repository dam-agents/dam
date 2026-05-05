import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useAgents() {
  return useQuery({
    ...trpc.agents.list.queryOptions(),
    meta: { errorToast: "Couldn't load agents" },
  });
}

/**
 * Per-agent secret + connection access. The agent might not yet be fully
 * reconciled (controller syncs asynchronously after create), so we swallow
 * errors silently rather than toasting.
 */
export function useAgentAccess(agentId: string | null) {
  return useQuery({
    ...trpc.secrets.getAgentAccess.queryOptions(
      agentId ? { agentId: agentId } : skipToken,
    ),
    retry: false,
  });
}

/**
 * Per-agent app-connection grants. Same controller-sync lag as
 * {@link useAgentAccess}, so errors stay silent and initial data defaults
 * to an empty grant list.
 */
export function useAgentConnections(agentId: string | null) {
  return useQuery({
    ...trpc.connections.getAgentConnections.queryOptions(
      agentId ? { agentId: agentId } : skipToken,
    ),
    retry: false,
  });
}
