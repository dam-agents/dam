import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { AppRouter } from "api-server-api";

import { getAccessToken } from "./auth.js";
import { onFetchError, onFetchSuccess } from "./lib/api-health.js";
import { requestLatencyLink } from "./modules/usage/lib/request-latency.js";

export const wsClient = createWSClient({
  url: () =>
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/trpc-ws`,
  connectionParams: async () => ({ token: await getAccessToken() }),
  lazy: { enabled: true, closeMs: 30_000 },
  keepAlive: { enabled: true, pongTimeoutMs: 5_000 },
  onOpen: () => onFetchSuccess(),
  onError: () => onFetchError(),
  onClose: () => onFetchError(),
});

export const api = createTRPCClient<AppRouter>({
  links: [requestLatencyLink, wsLink({ client: wsClient })],
});
