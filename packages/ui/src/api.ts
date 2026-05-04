import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "api-server-api";

import { getAccessToken } from "./auth.js";

export const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      headers: async () => {
        const token = await getAccessToken();
        return { Authorization: `Bearer ${token}` };
      },
    }),
  ],
});
