import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import type { AppRouter } from "api-server-api";
import type { Result } from "../../../result.js";
import type { AuthRequiredError } from "../../instance/domain/errors.js";

/**
 * Builds a typed `@trpc/client` against the api-server's `AppRouter`.
 *
 * Module-agnostic: every CLI module (instance, template, …) consumes
 * the same `AppRouter`, so the client itself has no module-level shape.
 * Bridging the auth module's `TokenProvider` is the caller's job — the
 * closure shape is the contract; the shared client has no compile-time
 * dependency on the auth module's discriminant.
 *
 * Auth failures must NOT cause a spurious HTTP round-trip with a missing
 * or stale token. `@trpc/client`'s `headers` callback is the synchronous
 * pipeline pre-request; throwing here aborts the call before the wire.
 * Service layers catch `AuthRequiredAtTransportError` and convert back
 * to a typed `Result`. The class is exported solely so services can
 * recognise it via `instanceof`; nothing else uses it.
 */

export type TrpcClient = TRPCClient<AppRouter>;

export interface TrpcClientDeps {
  /** Active Host URL, no trailing slash required — e.g.
   *  `http://api-server.localhost:4444`. */
  host: string;
  /** Bridges the auth module's `TokenProvider.getValidAccessToken(host)`
   *  without importing it. Returning an `auth-required` error aborts
   *  the request synchronously inside the link's header pipeline; see
   *  `AuthRequiredAtTransportError` below. */
  getToken: () => Promise<Result<string, AuthRequiredError>>;
  /** Test seam — defaults to the global `fetch`. Production callers omit
   *  this. */
  fetch?: typeof fetch;
}

/**
 * Internal sentinel used to smuggle an `auth-required` failure out of
 * `@trpc/client`'s synchronous header pipeline. Service layers catch it
 * via `instanceof` and re-raise as a typed `Result.err`.
 */
export class AuthRequiredAtTransportError extends Error {
  readonly kind = "auth-required" as const;
  constructor(reason: string) {
    super(reason);
    this.name = "AuthRequiredAtTransportError";
  }
}

export function createTrpcClient(deps: TrpcClientDeps): TrpcClient {
  const url = `${deps.host.replace(/\/+$/, "")}/api/trpc`;
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url,
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
