import type { StaleAcceptance } from "api-server-api";
import type { AuthDenialKind } from "./auth.js";

/** How the HTTP middleware chain answers each denial kind it can meet.
 *  Pure encoding — the gates decide, these tables translate. Sibling
 *  matrices live in trpc/mappers.ts (TRPCError) and
 *  agent-proxies/mappers.ts (raw upgrade status lines). */
export const httpAuthDenial: Record<
  AuthDenialKind,
  { status: 401 | 403 | 503; body: Record<string, string> }
> = {
  "missing-token": { status: 401, body: { error: "unauthorized" } },
  unauthorized: { status: 401, body: { error: "unauthorized" } },
  "auth-unavailable": { status: 503, body: { error: "auth unavailable" } },
  forbidden: {
    status: 403,
    body: {
      error: "forbidden",
      message: "Access pending approval. Contact your administrator.",
    },
  },
};

/** The terms denial carries data (which version to accept), so its HTTP
 *  encoding is a function of it rather than a static row. */
export function httpTermsStale(current: { version: string; hash: string }): {
  status: 412;
  body: StaleAcceptance;
} {
  return {
    status: 412,
    body: {
      error: "terms_stale",
      currentVersion: current.version,
      currentHash: current.hash,
    },
  };
}
