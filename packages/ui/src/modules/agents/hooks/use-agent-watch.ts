import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";

import { watchWithRetry } from "../../../lib/watch-retry.js";
import { agentTrpc } from "../agent-trpc.js";
import {
  useAgentLacksLiveUpdates,
  useIsAgentOperable,
} from "../api/queries.js";

type AgentTrpcClient = ReturnType<typeof agentTrpc>;

interface Subscription {
  unsubscribe: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether the Agent can be watched at all: it runs, its runtime knows how to push, and nothing has marked it unreachable. Watches that need a reachable runtime gate their channel with it; the session watch needs only a running one.
 */
export function useAgentLiveUpdates(agentId: string | null): boolean {
  const operable = useIsAgentOperable(agentId);
  const compat = useAgentLacksLiveUpdates(agentId);
  return operable && !compat;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one live channel from a running Agent, feeding one query key: it drops every notice whose shape it does not recognize, invalidates the one key the caller names, and lets watch-retry reopen it. A runtime too old for a channel answers NOT_FOUND, which `retryOn` turns into a silent stop. `inputKey` is what the subscription sends, so a change to it reopens the channel, and `enabled` is the caller's own reason to wait.
 */
export function useAgentWatch({
  agentId,
  enabled = true,
  inputKey = "",
  subscribe,
  notice,
  invalidate,
  retryOn,
}: {
  agentId: string | null;
  enabled?: boolean;
  inputKey?: string;
  subscribe: (
    trpc: AgentTrpcClient,
    onData: (notice: unknown) => void,
    onError: (error: unknown) => void,
  ) => Subscription;
  notice: { safeParse: (value: unknown) => { success: boolean } };
  invalidate: (queryClient: QueryClient, agentId: string) => void;
  retryOn?: (error: unknown) => boolean;
}) {
  const queryClient = useQueryClient();

  const open = useEffectEvent((id: string, onError: (error: unknown) => void) =>
    subscribe(
      agentTrpc(id),
      (data) => {
        if (!notice.safeParse(data).success) return;
        invalidate(queryClient, id);
      },
      (error) => {
        if (retryOn?.(error) !== false) onError(error);
      },
    ),
  );

  useEffect(() => {
    if (!agentId || !enabled) return;
    return watchWithRetry((onError) => open(agentId, onError));
  }, [agentId, enabled, inputKey]);
}
