import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { awaitsCapture, hasRunning } from "../lib/delegation-state.js";

const LIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 15_000;
const MISSING_ID_POLLS = 6;

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
    refetchInterval: (query) => {
      const nodes = query.state.data?.nodes;
      if (nodes && (hasRunning(nodes) || awaitsCapture(nodes, Date.now())))
        return LIVE_POLL_MS;
      const unresolved = !nodes || nodes.length < ids.length;
      const polls = query.state.dataUpdateCount + query.state.errorUpdateCount;
      return unresolved && polls < MISSING_ID_POLLS ? LIVE_POLL_MS : false;
    },
    retry: 2,
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: a driver's running children are read while its
 * turn runs, while its transcript names a fan-out, and for as long as the last
 * answer still had a child running, so a background fan-out stays in view
 * without every open chat polling forever.
 */
export function useRunningDelegations(
  driverAgentId: string | null,
  opts: { busy: boolean; watch: boolean },
) {
  const options = trpc.invocations.running.queryOptions(
    driverAgentId ? { driverAgentId } : skipToken,
  );
  const cached = useQueryClient().getQueryData(options.queryKey);
  return useQuery({
    ...options,
    enabled:
      driverAgentId !== null &&
      (opts.busy || opts.watch || hasRunning(cached?.nodes ?? [])),
    staleTime: 1_000,
    refetchInterval: (query) =>
      opts.busy || hasRunning(query.state.data?.nodes ?? [])
        ? LIVE_POLL_MS
        : IDLE_POLL_MS,
    retry: false,
  });
}

export function useDelegationTranscript(
  driverAgentId: string,
  id: string,
  enabled: boolean,
) {
  return useQuery({
    ...trpc.invocations.transcript.queryOptions(
      enabled ? { driverAgentId, id } : skipToken,
    ),
    staleTime: Infinity,
    retry: false,
  });
}
