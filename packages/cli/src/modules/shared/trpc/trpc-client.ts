import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import type { AppRouter } from "api-server-api";
import type { TokenProvider } from "../../auth/index.js";

export type TrpcClient = TRPCClient<AppRouter>;

export class AuthRequiredAtTransportError extends Error {
  readonly kind = "auth-required" as const;
  constructor(reason: string) {
    super(reason);
    this.name = "AuthRequiredAtTransportError";
  }
}

export function createTrpcClient(deps: {
  host: string;
  tokenProvider: TokenProvider;
  fetch?: typeof fetch;
}): TrpcClient {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${deps.host.replace(/\/+$/, "")}/api/trpc`,
        fetch: deps.fetch,
        headers: async () => {
          const result = await deps.tokenProvider.getValidAccessToken(
            deps.host,
          );
          if (result.ok) return { authorization: `Bearer ${result.value}` };
          const e = result.error as {
            kind: string;
            reason?: string;
            host?: string;
          };
          if (e.kind === "not-logged-in" || e.kind === "session-expired") {
            const reason =
              e.kind === "not-logged-in"
                ? e.host
                  ? `not logged in to ${e.host}`
                  : "not logged in"
                : e.host
                  ? `session expired for ${e.host}`
                  : "session expired";
            throw new AuthRequiredAtTransportError(reason);
          }
          throw new Error(e.reason ?? e.kind);
        },
      }),
    ],
  });
}
