import { createHmac } from "node:crypto";

/** Deterministic one-way hash for Keycloak `sub` values written to Postgres.
 *  Pseudonymizes — not anonymizes (GDPR Recital 26): the stored value can
 *  still be re-derived by anyone with the key, but a DB leak alone no longer
 *  reveals user identifiers. HMAC determinism preserves GROUP BY / DISTINCT /
 *  cross-table joins as long as the same key is used everywhere.
 *  See dam-ops#8. */
export interface SubPseudonymizer {
  hashSub(raw: string): string;
  hashSub(raw: string | null): string | null;
}

export function createSubPseudonymizer(key: string): SubPseudonymizer {
  if (!key) {
    throw new Error(
      "sub-pseudonymizer: ACTIVITY_HMAC_KEY must be set — refusing to write raw Keycloak subs",
    );
  }
  function hashSub(raw: string): string;
  function hashSub(raw: string | null): string | null;
  function hashSub(raw: string | null): string | null {
    if (raw === null) return null;
    return createHmac("sha256", key).update(raw).digest("hex");
  }
  return { hashSub };
}
