import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "api-server-api";

import { getAccessToken } from "./auth.js";
import { onFetchError, onFetchSuccess } from "./lib/api-health.js";
import { onTermsStale } from "./modules/terms/lib/on-terms-stale.js";

export const api = createTRPCClient<AppRouter>({
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
