import type { AuthDenialKind } from "../admission/auth.js";
import type { TermsDenialKind } from "../admission/terms.js";
import type { RelayDenialKind } from "./upgrade.js";

/** How the upgrade edge answers a refused relay attach — the raw HTTP
 *  status line written before the socket is destroyed. Covers every denial
 *  kind the relay admission composes: the admission gates (auth, terms)
 *  plus this folder's own authorization kinds. Sibling matrices live in
 *  admission/mappers.ts (HTTP chain) and trpc/mappers.ts (TRPCError). */
export const upgradeDenial: Record<
  AuthDenialKind | TermsDenialKind | RelayDenialKind,
  string
> = {
  "missing-token": "401 Unauthorized",
  unauthorized: "401 Unauthorized",
  forbidden: "403 Forbidden",
  "auth-unavailable": "503 Service Unavailable",
  "terms-stale": "412 Precondition Failed",
  // Existence-masking: a foreign agent id answers exactly like a missing
  // one, so ownership probing can't enumerate agents.
  "not-owner": "404 Not Found",
  "not-permitted": "403 Forbidden",
};
