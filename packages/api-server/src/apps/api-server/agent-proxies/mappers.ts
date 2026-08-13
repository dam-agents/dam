import type { AuthDenialKind } from "../admission/auth.js";
import type { TermsDenialKind } from "../admission/terms.js";
import type { RelayDenialKind } from "./upgrade.js";

export const upgradeDenial: Record<
  AuthDenialKind | TermsDenialKind | RelayDenialKind,
  string
> = {
  "missing-token": "401 Unauthorized",
  unauthorized: "401 Unauthorized",
  forbidden: "403 Forbidden",
  "auth-unavailable": "503 Service Unavailable",
  "terms-stale": "412 Precondition Failed",
  "not-owner": "404 Not Found",
  "not-permitted": "403 Forbidden",
};
