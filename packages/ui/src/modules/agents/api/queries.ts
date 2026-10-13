import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { type PlatformStore, useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import type { AgentState, AgentView } from "../../../types.js";
import { agentReadiness, untilAgentReady } from "../lib/agent-start.js";
import { vanishedAgentIds } from "../lib/deleted-agent.js";

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
      const previous = queryClient.getQueryData<{
        list: readonly AgentView[];
      }>(agentsKeys.listWithChannels())?.list;
      for (const id of vanishedAgentIds(previous, list)) {
        useStore.getState().markAgentDeleted(id);
        void queryClient.invalidateQueries({
          queryKey: trpc.agents.get.queryKey({ id }),
        });
      }
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

function operableIn(
  s: PlatformStore,
  agentId: string | null,
  runState: AgentState | undefined,
): boolean {
  return (
    agentId !== null &&
    runState === "running" &&
    !s.restartingAgents.has(agentId) &&
    !s.pausingAgents.has(agentId) &&
    !s.unreachableAgents.has(agentId)
  );
}

export function useIsAgentOperable(agentId: string | null): boolean {
  const runState = useAgentRunState(agentId);
  return useStore((s) => operableIn(s, agentId, runState));
}

export function untilAgentOperable(agentId: string): Promise<void> | null {
  const read = () => {
    const agent = queryClient
      .getQueryData<{ list: readonly AgentView[] }>(
        agentsKeys.listWithChannels(),
      )
      ?.list.find((a) => a.id === agentId);
    const store = useStore.getState();
    return agentReadiness(
      agent,
      operableIn(store, agentId, agent?.state),
      store.restartingAgents.has(agentId),
    );
  };
  return untilAgentReady(read, (onChange) => {
    const offQueries = queryClient.getQueryCache().subscribe(onChange);
    const offStore = useStore.subscribe(onChange);
    return () => {
      offQueries();
      offStore();
    };
  });
}

function isDeniedAgentRead(error: unknown): boolean {
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  return code === "NOT_FOUND" || code === "FORBIDDEN";
}

export function useIsAgentInaccessible(agentId: string | null): boolean {
  const { error } = useQuery({
    ...trpc.agents.get.queryOptions(agentId ? { id: agentId } : skipToken),
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

export function runtimeMigrationPlanOptions(agentId: string) {
  return {
    ...trpc.agents.planRuntimeMigration.queryOptions({ id: agentId }),
    staleTime: 5000,
  };
}

export function useRuntimeMigrationPlan(agentId: string) {
  return useQuery(runtimeMigrationPlanOptions(agentId));
}
