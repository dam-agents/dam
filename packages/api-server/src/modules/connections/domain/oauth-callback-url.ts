export function applyCallbackAlias(
  callbackUrl: string,
  localhostCallbackAlias?: string,
): string {
  if (!localhostCallbackAlias) return callbackUrl;
  return callbackUrl.replace(
    /^(https?:\/\/)localhost(?=:|\/|$)/,
    `$1${localhostCallbackAlias}`,
  );
}

export const DEFAULT_OAUTH_RETURN_TO = "/settings/connections";

// The OAuth callback is public and unauthenticated; only same-origin relative
// paths may be honored, so a stale or tampered state can never redirect off-site.
export function sanitizeReturnTo(returnTo: string | undefined): string {
  if (!returnTo) return DEFAULT_OAUTH_RETURN_TO;
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return DEFAULT_OAUTH_RETURN_TO;
  }
  return returnTo;
}
