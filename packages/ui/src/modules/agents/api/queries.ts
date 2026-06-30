import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import type { AgentState, AgentView } from "../../../types.js";

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
 * Single source for an agent's lifecycle state. The gate for "can the UI talk
 * to this pod?" is `=== "running"`; everything that reaches into the pod (ACP
 * WS, file tree, terminal) keys off this so they all agree.
 */
export function useAgentRunState(
  agentId: string | null,
): AgentState | undefined {
  const agents = useAgentsList();
  return agentId ? agents.find((a) => a.id === agentId)?.state : undefined;
}

/**
 * Whether the UI can actually talk to the pod right now. Three inputs, because
 * each catches a gap the others miss:
 *   - server reports `running` (the lifecycle truth, but it lags reality),
 *   - no optimistic restart in flight (covers a self-initiated Restart before
 *     the poll sees the dip),
 *   - not circuit-broken (covers any pod-down the server hasn't caught up to
 *     yet — env edits, controller restarts, schedules — via a real 502).
 * This is the single gate for pod-touching calls and the overlay alike.
 */
export function useIsAgentOperable(agentId: string | null): boolean {
  const runState = useAgentRunState(agentId);
  const restarting = useStore((s) =>
    agentId ? s.restartingAgents.has(agentId) : false,
  );
  const unreachable = useStore((s) =>
    agentId ? s.unreachableAgents.has(agentId) : false,
  );
  return runState === "running" && !restarting && !unreachable;
}

/**
 * Per-agent app-connection grants. The agent might not yet be fully reconciled
 * (controller syncs asynchronously after create), so errors stay silent and
 * initial data defaults to an empty grant list.
 */
export function useAgentConnections(agentId: string | null) {
  return useQuery({
    ...trpc.connections.getAgentConnections.queryOptions(
      agentId ? { agentId: agentId } : skipToken,
    ),
    retry: false,
    refetchOnMount: "always",
  });
}
