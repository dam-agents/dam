import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DelegationNode, PlatformContinuedFrom } from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { continuedFromOf } from "../lib/continued-from.js";
import {
  awaitsCapture,
  hasJustEnded,
  hasRunning,
} from "../lib/delegation-state.js";

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
  nodes: readonly DelegationNode[],
) {
  return useQuery({
    ...trpc.telemetry.invocationTurns.queryOptions(
      enabled && driverAgentId && ids.length > 0
        ? { driverAgentId, ids: [...ids] }
        : skipToken,
    ),
    staleTime: 2_000,
    refetchInterval: () =>
      hasRunning(nodes) || hasJustEnded(nodes, Date.now())
        ? LIVE_POLL_MS
        : false,
    retry: false,
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a driver's running children, as one of its
 * chats shows them: the ones that chat's Session spawned and the ones with no
 * recorded Session. They are read once when a chat first shows, while its
 * turn runs, while its transcript names a fan-out, and for as long as the last
 * answer still had a child running, so a background fan-out stays in view
 * without every open chat polling forever.
 */
export function useRunningDelegations(
  driverAgentId: string | null,
  sessionId: string | null,
  opts: { busy: boolean; watch: boolean },
) {
  const options = trpc.invocations.running.queryOptions(
    driverAgentId ? { driverAgentId, sessionId } : skipToken,
  );
  const state = useQueryClient().getQueryState(options.queryKey);
  const neverRead =
    state === undefined ||
    (state.dataUpdatedAt === 0 && state.errorUpdatedAt === 0);
  return useQuery({
    ...options,
    enabled:
      driverAgentId !== null &&
      (opts.busy ||
        opts.watch ||
        neverRead ||
        hasRunning(state.data?.nodes ?? [])),
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

export function useContinuedFrom(
  driverAgentId: string | null,
  invocationId: string | undefined,
): PlatformContinuedFrom | null {
  const ids = invocationId === undefined ? [] : [invocationId];
  const { data } = useQuery({
    ...trpc.invocations.tree.queryOptions(
      driverAgentId && invocationId
        ? { driverAgentId, ids: [invocationId] }
        : skipToken,
    ),
    staleTime: Infinity,
    retry: 2,
  });
  const node = data?.nodes.find((n) => ids.includes(n.id));
  return node ? continuedFromOf(node) : null;
}

export async function readContinuedFrom(
  driverAgentId: string,
  invocationId: string,
): Promise<PlatformContinuedFrom> {
  const tree = await queryClient.fetchQuery({
    ...trpc.invocations.tree.queryOptions({
      driverAgentId,
      ids: [invocationId],
    }),
    staleTime: Infinity,
  });
  const node = tree.nodes.find((n) => n.id === invocationId);
  if (!node) throw new Error("The sub-agent is no longer recorded.");
  return continuedFromOf(node);
}
