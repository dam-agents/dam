import type { Authenticate, AuthSite } from "./auth.js";

const RECHECK_MS = 10_000;

// UNIT_BOUNDARY_DESCRIPTION: An API key is checked only when a request or a connection opens, so a stream opened with a key would outlive the key's revocation or expiry. This re-checks the key every RECHECK_MS while the stream lives and calls onDead once the key no longer authenticates. The interval is the ceiling on how long a revoked key keeps a stream. Revoke can land on another api-server replica, so polling bounds it rather than the in-process revoke event; a revoke signal on the Redis bus is the upgrade path to an immediate close.
export function watchApiKey(
  authenticate: Authenticate,
  token: string | null | undefined,
  site: AuthSite,
  onDead: () => void,
): () => void {
  const timer = setInterval(() => {
    void authenticate(token, site).then((admitted) => {
      if (admitted.ok) return;
      clearInterval(timer);
      onDead();
    });
  }, RECHECK_MS);
  return () => clearInterval(timer);
}
