const GRANT_SCOPED_ERRORS = new Set([
  "invalid_grant",
  "bad_refresh_token",
  "access_denied",
]);

const CLIENT_SCOPED_ERRORS = new Set(["invalid_client", "unauthorized_client"]);

export interface TokenRejection {
  oauthError: string | undefined;
  status: number | undefined;
  oauthShapedBody: boolean;
  ownsClientSecret: boolean;
}

export function isPermanentTokenRejection(r: TokenRejection): boolean {
  if (r.oauthError === undefined)
    return r.oauthShapedBody && (r.status === 400 || r.status === 401);
  if (GRANT_SCOPED_ERRORS.has(r.oauthError)) return true;
  return CLIENT_SCOPED_ERRORS.has(r.oauthError) && r.ownsClientSecret;
}

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
