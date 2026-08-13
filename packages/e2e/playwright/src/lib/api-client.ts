import {
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  wsLink,
} from "@trpc/client";
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

export function createWsApiClient(token: string): {
  api: ApiClient;
  close: () => void;
} {
  const ws = createWSClient({
    url: `${baseUrl.replace(/^http/, "ws")}/api/trpc-ws`,
    connectionParams: { token },
  });
  return {
    api: createTRPCClient<AppRouter>({ links: [wsLink({ client: ws })] }),
    close: () => ws.close(),
  };
}
