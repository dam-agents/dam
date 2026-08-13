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
