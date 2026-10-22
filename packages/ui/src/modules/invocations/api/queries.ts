import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CONTINUED_FROM_TEXT_MAX,
  type DelegationNode,
  type PlatformContinuedFrom,
} from "api-server-api";

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

export type ContinuedFromRead =
  | { kind: "ready"; copy: PlatformContinuedFrom }
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string };

const MISSING = "The sub-agent is no longer recorded.";
const UNREADABLE = "The sub-agent's prompt and result could not be loaded.";
const TOO_LARGE =
  "The sub-agent's prompt or result is too large to continue from.";

function readOf(
  nodes: readonly DelegationNode[],
  invocationId: string,
): ContinuedFromRead {
  const node = nodes.find((n) => n.id === invocationId);
  if (!node) return { kind: "unavailable", reason: MISSING };
  const copy = continuedFromOf(node);
  return copy.prompt.length > CONTINUED_FROM_TEXT_MAX ||
    copy.result.length > CONTINUED_FROM_TEXT_MAX
    ? { kind: "unavailable", reason: TOO_LARGE }
    : { kind: "ready", copy };
}

export function useContinuedFrom(
  driverAgentId: string | null,
  invocationId: string | undefined,
): ContinuedFromRead | null {
  const { data, isError } = useQuery({
    ...trpc.invocations.tree.queryOptions(
      driverAgentId && invocationId
        ? { driverAgentId, ids: [invocationId] }
        : skipToken,
    ),
    staleTime: Infinity,
    retry: 2,
  });
  if (invocationId === undefined) return null;
  if (data) return readOf(data.nodes, invocationId);
  return isError
    ? { kind: "unavailable", reason: UNREADABLE }
    : { kind: "loading" };
}

export async function readContinuedFrom(
  driverAgentId: string,
  invocationId: string,
): Promise<ContinuedFromRead> {
  const tree = await queryClient.fetchQuery({
    ...trpc.invocations.tree.queryOptions({
      driverAgentId,
      ids: [invocationId],
    }),
    staleTime: Infinity,
  });
  return readOf(tree.nodes, invocationId);
}
