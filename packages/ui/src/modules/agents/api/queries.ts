import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { type PlatformStore, useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import type { AgentState, AgentView } from "../../../types.js";
import {
  type AgentReadiness,
  agentReadiness,
  untilAgentReady,
} from "../lib/agent-start.js";
import { departedAgents } from "../lib/deleted-agent.js";

export const agentsKeys = {
  root: ["agents"] as const,
  listWithChannels: () => [...agentsKeys.root, "list-with-channels"] as const,
};

interface AgentsData {
  list: readonly AgentView[];
  shared: readonly AgentView[];
}

export function useAgents() {
  return useQuery({
    queryKey: agentsKeys.listWithChannels(),
    queryFn: async () => {
      const [listed, availableChannels] = await Promise.all([
        api.agents.list.query({ scope: "all" }),
        api.channels.available.query(),
      ]);
      const list = listed.filter((a) => a.access.role === "owner");
      const shared = listed.filter((a) => a.access.role === "editor");
      const previous = queryClient.getQueryData<AgentsData>(
        agentsKeys.listWithChannels(),
      );
      const before = previous && [...previous.list, ...previous.shared];
      for (const { id, notice } of departedAgents(before, listed)) {
        useStore.getState().markAgentDeparted(id, notice);
        void queryClient.invalidateQueries({
          queryKey: trpc.agents.get.queryKey({ id }),
        });
      }
      return { list, shared, availableChannels };
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

export function useSharedAgents(): readonly AgentView[] {
  const { data } = useAgents();
  return data?.shared ?? EMPTY_AGENTS;
}

export function findAgent(
  data: AgentsData | undefined,
  agentId: string,
): AgentView | null {
  return (
    data?.list.find((a) => a.id === agentId) ??
    data?.shared.find((a) => a.id === agentId) ??
    null
  );
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

export type AgentReach = "operable" | "unreachable" | "inoperable";

function reachIn(
  s: PlatformStore,
  agentId: string | null,
  runState: AgentState | undefined,
): AgentReach {
  if (
    agentId === null ||
    runState !== "running" ||
    s.restartingAgents.has(agentId)
  )
    return "inoperable";
  return s.unreachableAgents.has(agentId) ? "unreachable" : "operable";
}

export function useAgentReach(agentId: string | null): AgentReach {
  const runState = useAgentRunState(agentId);
  return useStore((s) => reachIn(s, agentId, runState));
}

export function useIsAgentOperable(agentId: string | null): boolean {
  return useAgentReach(agentId) === "operable";
}

export function useIsAgentAnswerableSoon(agentId: string | null): boolean {
  const operable = useIsAgentOperable(agentId);
  const runState = useAgentRunState(agentId);
  const compat = useAgentLacksLiveUpdates(agentId);
  const unreachable = useStore((s) =>
    agentId ? s.unreachableAgents.has(agentId) : false,
  );
  return (
    operable ||
    (!compat &&
      !unreachable &&
      (runState === "starting" || runState === "preparing_workspace"))
  );
}

export function agentReadinessNow(
  agentId: string,
  evenUnreachable = false,
): AgentReadiness {
  const agent = queryClient
    .getQueryData<{ list: readonly AgentView[] }>(agentsKeys.listWithChannels())
    ?.list.find((a) => a.id === agentId);
  const store = useStore.getState();
  const reach = reachIn(store, agentId, agent?.state);
  return agentReadiness(
    agent,
    reach === "operable" || (evenUnreachable && reach === "unreachable"),
    store.restartingAgents.has(agentId),
  );
}

export function untilAgentOperable(
  agentId: string,
  { evenUnreachable = false } = {},
): Promise<void> | null {
  return untilAgentReady(
    () => agentReadinessNow(agentId, evenUnreachable),
    (onChange) => {
      const offQueries = queryClient.getQueryCache().subscribe(onChange);
      const offStore = useStore.subscribe(onChange);
      return () => {
        offQueries();
        offStore();
      };
    },
  );
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
