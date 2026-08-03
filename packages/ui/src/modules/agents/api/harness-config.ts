import { skipToken, useMutation, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { createAgentTrpc } from "../agent-trpc.js";
import { useIsAgentOperable } from "./queries.js";

export function useHarnessConfigStatus(agentId: string | null) {
  return useQuery({
    ...trpc.harnessConfig.status.queryOptions(
      agentId ? { agentId } : skipToken,
    ),
    retry: false,
    // Poll until the catalog lands (it only arrives once the agent has hello'd).
    refetchInterval: (query) => {
      const d = query.state.data;
      return d?.supported && !d.catalog ? 5000 : false;
    },
  });
}

// Cache one agent-runtime tRPC client per agentId (mirrors the files queries).
const currentClientCache = new Map<
  string,
  ReturnType<typeof createAgentTrpc>
>();
function agentTrpcFor(agentId: string) {
  let client = currentClientCache.get(agentId);
  if (!client) {
    client = createAgentTrpc(agentId);
    currentClientCache.set(agentId, client);
  }
  return client;
}

export const harnessConfigCurrentKey = (agentId: string) =>
  ["harness-config-current", agentId] as const;

export function useHarnessConfigCurrent(agentId: string | null) {
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: agentId ? harnessConfigCurrentKey(agentId) : ["hcc-disabled"],
    queryFn:
      agentId && operable
        ? () => agentTrpcFor(agentId).harnessConfig.current.query()
        : skipToken,
    retry: false,
  });
}

export function useApplyHarnessConfig() {
  return useMutation({
    ...trpc.harnessConfig.set.mutationOptions(),
    meta: { errorToast: "Failed to apply model settings" },
  });
}

// Polls whether the agent has applied all pending runtime state. Enabled only
// while a change is in flight; polls every 800ms until settled.
export function useHarnessConfigSettled(
  agentId: string | null,
  enabled: boolean,
) {
  return useQuery({
    ...trpc.harnessConfig.settled.queryOptions(
      agentId && enabled ? { agentId } : skipToken,
    ),
    refetchInterval: (query) =>
      enabled && query.state.data?.settled !== true ? 800 : false,
    retry: false,
  });
}
