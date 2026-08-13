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

export function sanitizeReturnTo(returnTo: string | undefined): string {
  if (!returnTo) return DEFAULT_OAUTH_RETURN_TO;
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return DEFAULT_OAUTH_RETURN_TO;
  }
  return returnTo;
}
