import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { inject } from "vitest";
import type { AppRouter } from "api-server-api";

const API_URL = "http://localtest.me:5555/api/trpc";

/** Create a tRPC client with an optional auth token. */
export function createClient(token?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: API_URL,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
    ],
  });
}

/** Default authenticated client — token is injected from globalSetup. */
export const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: API_URL,
      headers: () => {
        const token = inject("authToken");
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
