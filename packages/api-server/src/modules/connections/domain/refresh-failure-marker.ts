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
  userMessage?: string;
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
    Partial<{
      oauthError: string;
      status: number;
      oauthShapedBody: boolean;
      userMessage: string;
    }>;
  return {
    oauthError: e.oauthError,
    status: e.status,
    oauthShapedBody: e.oauthShapedBody === true,
    ...(e.userMessage ? { userMessage: e.userMessage } : {}),
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

export const REFRESH_SKEW_SECONDS = 5 * 60;
export const REFRESH_BACKOFF_BASE_MS = 60_000;
export const REFRESH_BACKOFF_MAX_MS = 30 * 60_000;

export interface RefreshBackoff {
  failures: number;
  nextAttempt: number;
}

export function backoffDelayMs(
  failures: number,
  baseMs: number,
  maxMs: number,
): number {
  const exponent = Math.min(Math.max(failures - 1, 0), 30);
  return Math.min(baseMs * 2 ** exponent, maxMs);
}

export function nextRefreshBackoff(
  previous: RefreshBackoff | undefined,
  nowMs: number,
  baseMs = REFRESH_BACKOFF_BASE_MS,
  maxMs = REFRESH_BACKOFF_MAX_MS,
): RefreshBackoff {
  const failures = (previous?.failures ?? 0) + 1;
  return {
    failures,
    nextAttempt: Math.floor(
      (nowMs + backoffDelayMs(failures, baseMs, maxMs)) / 1000,
    ),
  };
}
