import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";

import { getAccessToken } from "../../auth.js";

export function createAgentTrpc(agentId: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `/api/agents/${agentId}/trpc`,
        headers: async () => {
          const token = await getAccessToken();
          return { Authorization: `Bearer ${token}` };
        },
      }),
    ],
  });
}
