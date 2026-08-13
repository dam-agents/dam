import type { StaleAcceptance } from "api-server-api";
import type { AuthDenialKind } from "./auth.js";

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
