import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import {
  kbRootsNoticeSchema,
  type AppRouter as AgentRuntimeRouter,
} from "agent-runtime-api";

import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

const MAX_CONSECUTIVE_ERRORS = 5;

export interface KbShareRootsWatchHandle {
  close(): void;
}

export interface KbShareRootsWatchHandlers {
  onNotice: () => void;
  onDown: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one standing subscription to a shared KB pod's
 * kbPublish.watchRoots notice stream. The ws client reconnects on transient
 * blips, but a pod that stays unreachable (hibernated, deleted, or running an
 * agent-runtime without the procedure) must not be retried forever — after a
 * run of consecutive errors the watch closes itself and reports down, and the
 * saga reattaches on the next wake or turn instead.
 */
export function createKbShareRootsWatcher(
  namespace: string,
  log: (message: string) => void,
) {
  return function watchShareRoots(
    agentId: string,
    roots: readonly string[],
    handlers: KbShareRootsWatchHandlers,
  ): KbShareRootsWatchHandle {
    let closed = false;
    let consecutiveErrors = 0;
    let subscription: { unsubscribe(): void } | undefined;

    function close(): void {
      if (closed) return;
      closed = true;
      subscription?.unsubscribe();
      wsClient.close();
    }

    function down(reason: string): void {
      if (closed) return;
      log(`kb roots watch for ${agentId} is down: ${reason}`);
      close();
      handlers.onDown();
    }

    const wsClient = createWSClient({
      url: `ws://${podBaseUrl(agentId, namespace)}/api/trpc-ws`,
      keepAlive: { enabled: true },
      onError: () => {
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          down("repeated connection errors");
        }
      },
    });
    const client = createTRPCClient<AgentRuntimeRouter>({
      links: [wsLink({ client: wsClient })],
    });
    subscription = client.kbPublish.watchRoots.subscribe(
      { roots: [...roots] },
      {
        onData: (raw) => {
          if (!kbRootsNoticeSchema.safeParse(raw).success) {
            log(`dropped unknown kb roots notice from ${agentId}`);
            return;
          }
          consecutiveErrors = 0;
          handlers.onNotice();
        },
        onError: () => down("subscription error"),
      },
    );
    if (closed) subscription.unsubscribe();

    return { close };
  };
}
