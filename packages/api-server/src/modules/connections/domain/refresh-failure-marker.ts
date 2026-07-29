/** The refresh-failure marker (`auth.refreshFailedAt`, epoch seconds) and the
 *  rule for when a token-endpoint rejection earns one.
 *
 *  A marked connection derives `expired` and leaves the refresh loop's due set
 *  — so the marker must mean "this credential cannot recover without someone
 *  supplying a new one", never "this attempt failed". */

// The user's grant itself is dead (revoked consent, expired refresh token):
// only re-authenticating revives it, so retrying is pure waste.
const GRANT_SCOPED_ERRORS = new Set([
  "invalid_grant",
  "bad_refresh_token",
  "access_denied",
]);

// The *client's* credentials were rejected. Permanent only when the connection
// carries that secret itself — an operator-baked client secret is fixed by
// deploy config, and parking those would demand a re-consent from every
// affected user for something the next refresh tick heals on its own.
const CLIENT_SCOPED_ERRORS = new Set(["invalid_client", "unauthorized_client"]);

export interface TokenRejection {
  /** The parsed OAuth `error` code, if the provider returned one. */
  oauthError: string | undefined;
  status: number | undefined;
  /** Whether the connection stores the client secret / signing key itself. */
  ownsClientSecret: boolean;
}

export function isPermanentTokenRejection(r: TokenRejection): boolean {
  // No machine-readable code: a token endpoint answering 400/401 rejected the
  // credential rather than failing to serve the request. Every provider in the
  // catalog does return a code, so this fallback can't mismark a fleet.
  if (r.oauthError === undefined) return r.status === 400 || r.status === 401;
  if (GRANT_SCOPED_ERRORS.has(r.oauthError)) return true;
  return CLIENT_SCOPED_ERRORS.has(r.oauthError) && r.ownsClientSecret;
}

// Setting the marker has no counterpart helper: the refresh loop writes it as
// a server-side jsonb merge so a concurrent credential fix is never clobbered.

/** Any successful token write clears the marker — the credential just proved
 *  itself, whatever rejected it before. */
export function withoutRefreshFailureMarker<
  T extends { refreshFailedAt?: number },
>(auth: T): T {
  if (auth.refreshFailedAt === undefined) return auth;
  const next = { ...auth };
  delete next.refreshFailedAt;
  return next;
}
