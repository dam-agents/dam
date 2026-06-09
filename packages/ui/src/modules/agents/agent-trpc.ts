import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";

import { getAccessToken } from "../../auth.js";
import { useStore } from "../../store.js";

export function createAgentTrpc(agentId: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `/api/agents/${agentId}/trpc`,
        headers: async () => {
          const token = await getAccessToken();
          return { Authorization: `Bearer ${token}` };
        },
        // Reachability circuit breaker. The proxy returns 502 "agent
        // unreachable" when the pod is down (distinct from a tRPC app error,
        // which comes back with the pod's own status + error body). Trip on
        // 502, clear once the pod answers, so every per-agent call feeds the
        // gate without per-call-site handling.
        fetch: async (url, options) => {
          const res = await globalThis.fetch(url as RequestInfo, options);
          const store = useStore.getState();
          if (res.status === 502) store.markAgentUnreachable(agentId);
          else if (res.ok) store.clearAgentUnreachable(agentId);
          return res;
        },
      }),
    ],
  });
}
