/** A marked connection derives `expired` and leaves the refresh loop's due
 *  set, so the marker must mean "this credential cannot recover without
 *  someone supplying a new one" — never "this attempt failed". */

// The user's grant itself is dead (revoked consent, expired refresh token):
// only re-authenticating revives it, so retrying is pure waste.
const GRANT_SCOPED_ERRORS = new Set([
  "invalid_grant",
  "bad_refresh_token",
  "access_denied",
]);

// The *client's* credentials were rejected. Permanent only when the connection
// carries that secret itself: an operator-supplied one is fixed by redeploy, and
// parking those would demand a needless re-consent from every affected user.
const CLIENT_SCOPED_ERRORS = new Set(["invalid_client", "unauthorized_client"]);

export interface TokenRejection {
  oauthError: string | undefined;
  status: number | undefined;
  /** Whether the connection stores the client secret / signing key itself. */
  ownsClientSecret: boolean;
}

export function isPermanentTokenRejection(r: TokenRejection): boolean {
  // No code to go on: a token endpoint answering 400/401 rejected the
  // credential rather than failing to serve the request.
  if (r.oauthError === undefined) return r.status === 400 || r.status === 401;
  if (GRANT_SCOPED_ERRORS.has(r.oauthError)) return true;
  return CLIENT_SCOPED_ERRORS.has(r.oauthError) && r.ownsClientSecret;
}

// No counterpart setter: the loop writes the marker as a server-side jsonb
// merge, so a concurrent credential fix is never clobbered.

/** Any successful token write clears the marker. */
export function withoutRefreshFailureMarker<
  T extends { refreshFailedAt?: number },
>(auth: T): T {
  if (auth.refreshFailedAt === undefined) return auth;
  const next = { ...auth };
  delete next.refreshFailedAt;
  return next;
}
