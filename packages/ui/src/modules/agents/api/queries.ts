import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import type { AgentState, AgentView } from "../../../types.js";

export const agentsKeys = {
  root: ["agents"] as const,
  listWithChannels: () => [...agentsKeys.root, "list-with-channels"] as const,
};

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
    staleTime: 5000,
    meta: { errorToast: "Can't reach the server — agent list may be stale" },
  });
}

const EMPTY_AGENTS: readonly AgentView[] = Object.freeze([]);

export function useAgentsList(): readonly AgentView[] {
  const { data } = useAgents();
  return data?.list ?? EMPTY_AGENTS;
}

export function useAgentLacksLiveUpdates(agentId: string | null): boolean {
  const agents = useAgentsList();
  if (!agentId) return false;
  const agent = agents.find((a) => a.id === agentId);
  return agent ? !agent.features.liveUpdates : false;
}

export function agentLacksLiveUpdates(agentId: string): boolean {
  const data = queryClient.getQueryData<{ list: readonly AgentView[] }>(
    agentsKeys.listWithChannels(),
  );
  const agent = data?.list.find((a) => a.id === agentId);
  return agent ? !agent.features.liveUpdates : false;
}

export function useAgentRunState(
  agentId: string | null,
): AgentState | undefined {
  const agents = useAgentsList();
  return agentId ? agents.find((a) => a.id === agentId)?.state : undefined;
}

export function useAgentDisplayName(agentId: string): string;
export function useAgentDisplayName(agentId: string | null): string | null;
export function useAgentDisplayName(agentId: string | null): string | null {
  const agents = useAgentsList();
  if (!agentId) return null;
  return agents.find((a) => a.id === agentId)?.name ?? agentId;
}

export function useIsAgentOperable(agentId: string | null): boolean {
  const runState = useAgentRunState(agentId);
  const restarting = useStore((s) =>
    agentId ? s.restartingAgents.has(agentId) : false,
  );
  const pausing = useStore((s) =>
    agentId ? s.pausingAgents.has(agentId) : false,
  );
  const unreachable = useStore((s) =>
    agentId ? s.unreachableAgents.has(agentId) : false,
  );
  return runState === "running" && !restarting && !pausing && !unreachable;
}

function isDeniedAgentRead(error: unknown): boolean {
  if ((window as { __MOCK_MODE__?: boolean }).__MOCK_MODE__) return false;
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  return code === "NOT_FOUND" || code === "FORBIDDEN";
}

export function useIsAgentInaccessible(agentId: string | null): boolean {
  const { error } = useQuery({
    ...trpc.agents.get.queryOptions(
      (window as { __MOCK_MODE__?: boolean }).__MOCK_MODE__
        ? skipToken
        : agentId
          ? { id: agentId }
          : skipToken,
    ),
    retry: false,
  });
  return isDeniedAgentRead(error);
}

export function useAgentConnections(agentId: string | null) {
  return useQuery({
    ...trpc.connections.getAgentConnections.queryOptions(
      agentId ? { agentId: agentId } : skipToken,
    ),
    retry: false,
    refetchOnMount: "always",
  });
}
