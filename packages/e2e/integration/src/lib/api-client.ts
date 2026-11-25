import {
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  wsLink,
} from "@trpc/client";
import type { AppRouter } from "api-server-api";
import { baseUrl } from "../config.js";
import { bodyKeepingFetch, namedFailures } from "./trpc-failures.js";

export type ApiClient = ReturnType<typeof createTRPCClient<AppRouter>>;

export function createApiClient(token: string): ApiClient {
  return createTRPCClient<AppRouter>({
    links: [
      namedFailures(),
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        headers: { Authorization: `Bearer ${token}` },
        fetch: bodyKeepingFetch(),
      }),
    ],
  });
}

export function createWsApiClient(token: string): {
  api: ApiClient;
  close: () => void;
} {
  const ws = createWSClient({
    url: `${baseUrl.replace(/^http/, "ws")}/api/trpc-ws`,
    connectionParams: { token },
    retryDelayMs: () => 3_600_000,
  });
  return {
    api: createTRPCClient<AppRouter>({
      links: [namedFailures(), wsLink({ client: ws })],
    }),
    close: () => ws.close(),
  };
}

export function createRefreshingApiClient(
  token: () => Promise<string>,
): ApiClient {
  return createTRPCClient<AppRouter>({
    links: [
      namedFailures(),
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        headers: async () => ({ Authorization: `Bearer ${await token()}` }),
        fetch: bodyKeepingFetch(),
      }),
    ],
  });
}
