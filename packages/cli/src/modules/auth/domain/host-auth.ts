/**
 * Per-host credential record persisted in `$XDG_STATE_HOME/dam/auth.toml`.
 * `host` is the key into the file; the rest live inside the corresponding
 * `[hosts."..."]` table.
 *
 * Pure value type — no I/O, no Date.now(). The proactive-refresh predicate
 * takes `now` as a parameter so it is deterministic and unit-testable.
 */
export interface HostAuth {
  issuer: string;
  username: string;
  sub: string;
  /** Public OAuth client id used at login; persisted so refresh/logout
   *  use the same client id without re-probing `/api/auth/config`. */
  cliClientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * True when the access token will expire within `bufferSeconds` of `now` —
 * the Token Provider treats this window as "refresh proactively." Default
 * buffer in v1 is 60 seconds. Boundary semantics: returns true at exactly
 * the boundary (`now + buffer === expiresAt`), so a buffer of 60s with a
 * token expiring in 60s refreshes.
 */
export function isWithinRefreshBuffer(
  host: HostAuth,
  now: Date,
  bufferSeconds: number,
): boolean {
  return now.getTime() + bufferSeconds * 1000 >= host.expiresAt.getTime();
}
