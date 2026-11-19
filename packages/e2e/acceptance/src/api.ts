import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "api-server-api";

import { type Account, accessToken } from "./auth.js";
import { baseUrl } from "./config.js";

export type Api = ReturnType<typeof createTRPCClient<AppRouter>>;

const tokenTtlMs = 60_000;

export function tokenSource(account: Account): () => Promise<string> {
  let token: string | undefined;
  let fetchedAt = 0;
  return async () => {
    if (token === undefined || Date.now() - fetchedAt > tokenTtlMs) {
      token = await accessToken(account);
      fetchedAt = Date.now();
    }
    return token;
  };
}

export function apiFor(token: () => Promise<string>): Api {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        headers: async () => ({ Authorization: `Bearer ${await token()}` }),
      }),
    ],
  });
}
