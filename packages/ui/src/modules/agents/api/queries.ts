import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";

export const agentsKeys = {
  root: ["agents"] as const,
  listWithChannels: () => [...agentsKeys.root, "list-with-channels"] as const,
};

/**
 * Combined query for the agents list + available channels. The two are
 * always consumed together (agent panels render channel pills), and pairing
 * them avoids a render pass where one is loaded but not the other.
 */
export function useAgents() {
  return useQuery({
    queryKey: agentsKeys.listWithChannels(),
    queryFn: async () => {
      const [list, availableChannels] = await Promise.all([
        api.agents.list.query(),
        api.channels.available.query(),
      ]);
      return { list, availableChannels };
    },
    refetchInterval: 5000,
    staleTime: 5000,
    meta: { errorToast: "Can't reach the server — agent list may be stale" },
  });
}

const EMPTY_AGENTS: readonly AgentView[] = Object.freeze([]);

/**
 * Stable view of just the agents list. Inline `data?.list ?? []` mints a
 * fresh array on every render and destabilizes any useEffect / useMemo deps
 * downstream — this hook returns the same `EMPTY_AGENTS` reference until
 * real data arrives.
 */
export function useAgentsList(): readonly AgentView[] {
  const { data } = useAgents();
  return data?.list ?? EMPTY_AGENTS;
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
