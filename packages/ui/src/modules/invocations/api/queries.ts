import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { hasRunning } from "../lib/delegation-state.js";

const LIVE_POLL_MS = 5_000;

export function useDelegationTree(
  driverAgentId: string | null,
  ids: readonly string[],
) {
  return useQuery({
    ...trpc.invocations.tree.queryOptions(
      driverAgentId && ids.length > 0
        ? { driverAgentId, ids: [...ids] }
        : skipToken,
    ),
    staleTime: 2_000,
    refetchInterval: (query) =>
      query.state.data && hasRunning(query.state.data.nodes)
        ? LIVE_POLL_MS
        : false,
    retry: false,
  });
}

export function useInvocationTurns(
  driverAgentId: string | null,
  ids: readonly string[],
  enabled: boolean,
  live: boolean,
) {
  return useQuery({
    ...trpc.telemetry.invocationTurns.queryOptions(
      enabled && driverAgentId && ids.length > 0
        ? { driverAgentId, ids: [...ids] }
        : skipToken,
    ),
    staleTime: 2_000,
    refetchInterval: live ? LIVE_POLL_MS : false,
    retry: false,
  });
}

export function useRunningDelegations(
  driverAgentId: string | null,
  active: boolean,
) {
  return useQuery({
    ...trpc.invocations.running.queryOptions(
      active && driverAgentId ? { driverAgentId } : skipToken,
    ),
    staleTime: 1_000,
    refetchInterval: active ? LIVE_POLL_MS : false,
    retry: false,
  });
}
