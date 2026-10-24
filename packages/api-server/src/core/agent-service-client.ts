import {
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  httpLink,
  wsLink,
} from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";

import { agentServiceAddress } from "../modules/agents/infrastructure/k8s.js";

type FetchLike = NonNullable<Parameters<typeof httpLink>[0]["fetch"]>;

const AGENT_SERVICE_TIMEOUT_MS = 15_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one way the api-server calls an Agent's
 * runtime over HTTP. Every call is bounded: a runtime that accepts the
 * connection and never answers fails the call in `timeoutMs` instead of
 * holding a caller for the transport's five-minute headers timeout. A caller
 * that can legitimately run long passes its own budget; the timeout composes
 * with any signal the caller sets per call, whichever comes first.
 */
export function agentServiceClient(
  agentId: string,
  namespace: string,
  opts: { timeoutMs?: number; batch?: boolean; fetch?: FetchLike } = {},
) {
  const fetchImpl = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? AGENT_SERVICE_TIMEOUT_MS;
  const link = {
    url: `http://${agentServiceAddress(agentId, namespace)}/api/trpc`,
    fetch: ((request, init) =>
      fetchImpl(request, {
        ...init,
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []),
          AbortSignal.timeout(timeoutMs),
        ]),
      })) satisfies FetchLike,
  };
  return createTRPCClient<AppRouter>({
    links: [opts.batch === false ? httpLink(link) : httpBatchLink(link)],
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the WebSocket half of the same channel, for the
 * session watch. One socket carries both the watch and the reads it triggers,
 * because a notice is always followed by a read.
 */
export function agentServiceWsClient(
  agentId: string,
  namespace: string,
  opts: { webSocket?: typeof WebSocket; onError: () => void },
) {
  const wsClient = createWSClient({
    url: `ws://${agentServiceAddress(agentId, namespace)}/api/trpc-ws`,
    WebSocket: opts.webSocket,
    keepAlive: { enabled: true },
    onError: opts.onError,
  });
  return {
    wsClient,
    client: createTRPCClient<AppRouter>({
      links: [wsLink({ client: wsClient })],
    }),
  };
}
