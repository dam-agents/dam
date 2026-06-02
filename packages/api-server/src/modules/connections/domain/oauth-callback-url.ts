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
