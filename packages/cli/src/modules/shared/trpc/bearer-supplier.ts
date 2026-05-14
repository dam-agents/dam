import type { TokenProvider } from "../../auth/index.js";
import type { AuthRequiredError } from "../../instance/domain/errors.js";
import type { Result } from "../../../result.js";

/**
 * Bridges the auth module's `TokenProvider.getValidAccessToken(host)`
 * into the closure shape `trpc-client`'s `getToken` callback consumes.
 *
 * Every CLI module that builds a tRPC client (`instance`, `template`, …)
 * needs the same bridge: call the token provider, map a token-side
 * `auth-required` situation into a typed `Result.err`, and surface
 * anything else as a thrown `Error` so the trpc-client's transport-error
 * path takes over. Centralising it here keeps the classification rules
 * in one place — Humr review on #203 flagged this duplication.
 *
 * Only `not-logged-in` and `session-expired` route to `auth-required`,
 * because those are the cases where `dam auth login` is the fix.
 * Everything else (refresh failures, auth-store I/O, malformed store) is
 * a non-auth condition that login can't repair, so it surfaces as a
 * thrown error which the service layer translates to a `transport`
 * error carrying the original reason.
 */
export function createBearerSupplier(
  tokenProvider: TokenProvider,
  host: string,
): () => Promise<Result<string, AuthRequiredError>> {
  return async () => {
    const result = await tokenProvider.getValidAccessToken(host);
    if (result.ok) return result;
    const classified = classifyTokenProviderError(result.error);
    if (classified.kind === "auth-required") {
      return { ok: false, error: classified };
    }
    throw new Error(classified.reason);
  };
}

interface ReasonBearing {
  reason?: string;
  host?: string;
  kind: string;
}

type ClassifiedError =
  | { kind: "auth-required"; reason: string }
  | { kind: "non-auth"; reason: string };

function classifyTokenProviderError(e: unknown): ClassifiedError {
  if (typeof e !== "object" || e === null) {
    return { kind: "non-auth", reason: "auth failure" };
  }
  const re = e as ReasonBearing;
  switch (re.kind) {
    case "not-logged-in":
      return { kind: "auth-required", reason: re.host ? `not logged in to ${re.host}` : "not logged in" };
    case "session-expired":
      return { kind: "auth-required", reason: re.host ? `session expired for ${re.host}` : "session expired" };
    default:
      return { kind: "non-auth", reason: re.reason ?? re.kind };
  }
}
