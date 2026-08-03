/** What the probe needs from the identity provider. Fulfilled by
 *  `KeycloakUserDirectory.isActive`: false only on a definitive answer
 *  (user gone or disabled), throws on transient failures. */
export interface OwnerDirectoryPort {
  isActive(sub: string): Promise<boolean>;
}

const DEFAULT_TTL_MS = 60_000;

/**
 * Per-request owner-active probe for API-key principals. The probe hits
 * Keycloak's admin API; a CI burst against API keys would otherwise pressure
 * Keycloak and add per-call latency. We cache only the *positive* result for
 * one TTL — a deleted/disabled owner remains valid for up to one TTL after the
 * change, which is acceptable for the key-revocation lifecycle (operators
 * revoke keys explicitly when immediate cutoff is required). Negative results
 * are never cached so re-enabling an owner takes effect immediately. Lookup
 * *failures* (5xx, timeout — surfaced as throws by the port) treat the owner as
 * active to avoid mass false-401s during a transient Keycloak outage — Keycloak
 * signing is still required for fresh JWT issuance, so a sustained outage
 * cannot produce new principals.
 */
export function createOwnerActiveProbe(deps: {
  directory: OwnerDirectoryPort;
  ttlMs?: number;
  now?: () => number;
}): (sub: string) => Promise<boolean> {
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const now = deps.now ?? Date.now;
  const activeUntil = new Map<string, number>();

  return async function verifyOwnerActive(sub) {
    const hit = activeUntil.get(sub);
    if (hit !== undefined && hit > now()) return true;
    try {
      const active = await deps.directory.isActive(sub);
      if (active) activeUntil.set(sub, now() + ttlMs);
      return active;
    } catch {
      // Transient IdP failure — fail open so a paused Keycloak doesn't
      // mass-revoke every active API key. Definitive negatives (404,
      // disabled) resolve, not throw, so they are never masked here.
      return true;
    }
  };
}
