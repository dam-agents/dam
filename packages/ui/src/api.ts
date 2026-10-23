import {
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  wsLink,
} from "@trpc/client";
import type { AppRouter } from "api-server-api";

import { getAccessToken } from "./auth.js";
import { onFetchError, onFetchSuccess } from "./lib/api-health.js";
import { onTermsStale } from "./modules/terms/lib/on-terms-stale.js";

function createMockApi() {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        fetch: async (input, init) => {
          try {
            const response = await globalThis.fetch(input, init);
            if (response.ok) onFetchSuccess();
            else if (response.status === 502 || response.status === 503)
              onFetchError();
            else if (response.status === 412) {
              const clone = response.clone();
              try {
                const body = (await clone.json()) as { error?: string };
                if (body.error === "terms_stale") onTermsStale();
              } catch {}
            }
            return response;
          } catch (error) {
            onFetchError();
            throw error;
          }
        },
        headers: async () => ({
          Authorization: `Bearer ${await getAccessToken()}`,
        }),
      }),
    ],
  });
}

function createLiveApi() {
  const ws = createWSClient({
    url: () =>
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/trpc-ws`,
    connectionParams: async () => ({ token: await getAccessToken() }),
    lazy: { enabled: true, closeMs: 30_000 },
    keepAlive: { enabled: true },
    onOpen: () => onFetchSuccess(),
    onError: () => onFetchError(),
    onClose: () => onFetchError(),
  });
  return {
    api: createTRPCClient<AppRouter>({ links: [wsLink({ client: ws })] }),
    wsClient: ws,
  };
}

export let wsClient: ReturnType<typeof createWSClient> | undefined;

export const api = import.meta.env.VITE_MOCK
  ? createMockApi()
  : (() => {
      const live = createLiveApi();
      wsClient = live.wsClient;
      return live.api;
    })();
