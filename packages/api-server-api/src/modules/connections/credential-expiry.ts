import type { CredentialCheck } from "./types.js";

export const CREDENTIAL_EXPIRES_SOON_MS = 24 * 60 * 60 * 1000;

export function credentialExpiresSoon(
  check: Pick<CredentialCheck, "expiresAt">,
  now: number = Date.now(),
): boolean {
  if (!check.expiresAt) return false;
  const at = Date.parse(check.expiresAt);
  return !Number.isNaN(at) && at - now < CREDENTIAL_EXPIRES_SOON_MS;
}
