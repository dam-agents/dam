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
  /** The response body was OAuth-shaped — evidence the answer came from the
   *  token endpoint itself, not a proxy/WAF error page in front of it. */
  oauthShapedBody: boolean;
  /** Whether the connection stores the client secret / signing key itself. */
  ownsClientSecret: boolean;
}

export function isPermanentTokenRejection(r: TokenRejection): boolean {
  // No code to go on: a bare 400/401 is conclusive only when the body shape
  // proves the token endpoint answered — an HTML page from a proxy in front
  // of it is a transient upstream failure, left to the retry backoff.
  if (r.oauthError === undefined)
    return r.oauthShapedBody && (r.status === 400 || r.status === 401);
  if (GRANT_SCOPED_ERRORS.has(r.oauthError)) return true;
  return CLIENT_SCOPED_ERRORS.has(r.oauthError) && r.ownsClientSecret;
}

/** Structural view of the engines' token-endpoint rejection, discriminated on
 *  the error name so services never need the infrastructure class at runtime. */
export function tokenRejectionOf(
  err: unknown,
): Omit<TokenRejection, "ownsClientSecret"> | null {
  if (!(err instanceof Error) || err.name !== "OAuthTokenEndpointError")
    return null;
  const e = err as Error &
    Partial<{ oauthError: string; status: number; oauthShapedBody: boolean }>;
  return {
    oauthError: e.oauthError,
    status: e.status,
    oauthShapedBody: e.oauthShapedBody === true,
  };
}

// No counterpart setter: the loop writes the marker as a server-side jsonb
// merge, so a concurrent credential fix is never clobbered.

/** Any successful token write clears both failure records: the permanent
 *  marker (which parks the connection) and the transient retry backoff. Every
 *  caller spreads the existing `auth` rather than replacing it, so a backoff
 *  left behind here would outlive the failure that set it and throttle a
 *  healthy connection for good. */
export function withoutRefreshFailureMarker<
  T extends { refreshFailedAt?: number; refreshBackoff?: unknown },
>(auth: T): T {
  if (auth.refreshFailedAt === undefined && auth.refreshBackoff === undefined)
    return auth;
  const next = { ...auth };
  delete next.refreshFailedAt;
  delete next.refreshBackoff;
  return next;
}
