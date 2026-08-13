import { createHmac } from "node:crypto";

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
