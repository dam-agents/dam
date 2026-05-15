import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import type { AppRouter } from "api-server-api";
import type { Result } from "../../../result.js";
import type { AuthRequiredError } from "../../instance/domain/errors.js";

export type TrpcClient = TRPCClient<AppRouter>;

// Thrown inside the tRPC header pipeline to abort a request before the wire when auth fails.
export class AuthRequiredAtTransportError extends Error {
  readonly kind = "auth-required" as const;
  constructor(reason: string) { super(reason); this.name = "AuthRequiredAtTransportError"; }
}

export function createTrpcClient(deps: {
  host: string;
  getToken: () => Promise<Result<string, AuthRequiredError>>;
  fetch?: typeof fetch;
}): TrpcClient {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${deps.host.replace(/\/+$/, "")}/api/trpc`,
        fetch: deps.fetch,
        headers: async () => {
          const tok = await deps.getToken();
          if (!tok.ok) throw new AuthRequiredAtTransportError(tok.error.reason);
          return { authorization: `Bearer ${tok.value}` };
        },
      }),
    ],
  });
}
