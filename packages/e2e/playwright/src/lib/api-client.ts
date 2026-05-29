import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "api-server-api";
import { baseUrl } from "../config.js";

export type ApiClient = ReturnType<typeof createTRPCClient<AppRouter>>;

export function createApiClient(token: string): ApiClient {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        headers: { Authorization: `Bearer ${token}` },
      }),
    ],
  });
}
