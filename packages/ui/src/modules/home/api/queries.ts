import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { useMemo } from "react";

import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";
import { useAgents, useAgentsList } from "../../agents/api/queries.js";
import { useApprovalsForOwner } from "../../approvals/api/queries.js";
import { type FeedItem, toFeedItems } from "../lib/feed-item.js";

const ATTENTION_STALE_MS = 5_000;

export function useAttention() {
  return useQuery({
    ...trpc.attention.listForOwner.queryOptions(),
    staleTime: ATTENTION_STALE_MS,
  });
}

interface Feed {
  items: FeedItem[];
  workingAgentIds: ReadonlySet<string>;
  /** UNIT_BOUNDARY_DESCRIPTION: absent until the attention record has loaded. */
  workingByAgent: ReadonlyMap<string, boolean>;
  agents: readonly AgentView[];
  runningAgents: readonly AgentView[];
  hasAgents: boolean;
  loadingAgents: boolean;
  loadingFeed: boolean;
  feedUnreadable: boolean;
  approvalsUnreadable: boolean;
}

export function useFeed(): Feed {
  const agents = useAgentsList();
  const agentsQuery = useAgents();
  const approvals = useApprovalsForOwner();
  const attention = useAttention();

  const runningAgents = useMemo(
    () => agents.filter((agent) => agent.state === "running"),
    [agents],
  );
  const runningAgentIds = useMemo(
    () => new Set(runningAgents.map((agent) => agent.id)),
    [runningAgents],
  );

  const items = toFeedItems({
    approvals: (approvals.data ?? []).filter((a) => a.status === "pending"),
    attention: attention.data?.items ?? [],
    runningAgentIds,
  });

  const workingAgentIds = new Set(
    items.filter((i) => i.kind === "in-progress").map((i) => i.agentId),
  );

  return {
    items,
    workingAgentIds,
    workingByAgent: new Map(
      attention.data
        ? runningAgents.map(
            (agent) => [agent.id, workingAgentIds.has(agent.id)] as const,
          )
        : [],
    ),
    agents,
    runningAgents,
    hasAgents: agents.length > 0,
    loadingAgents: agentsQuery.isPending,
    loadingFeed: approvals.isPending || attention.isPending,
    feedUnreadable: attention.isError,
    approvalsUnreadable: approvals.isError,
  };
}

type SpendBreakdown = inferOutput<typeof trpc.metrics.spendBreakdown>;

export function cachedSpend(queryClient: QueryClient, homeSpend: string) {
  return queryClient
    .getQueriesData<SpendBreakdown>({
      ...trpc.metrics.spendBreakdown.queryFilter(),
      predicate: (query) =>
        query.meta?.homeSpend === homeSpend && query.state.data !== undefined,
    })
    .sort(
      ([a], [b]) =>
        (queryClient.getQueryState(b)?.dataUpdatedAt ?? 0) -
        (queryClient.getQueryState(a)?.dataUpdatedAt ?? 0),
    )[0]?.[1];
}
