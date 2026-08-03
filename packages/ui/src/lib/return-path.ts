/** Where the user was headed before an interstitial took the browser off it.
 *
 *  Two interstitials rewrite the URL after boot — the Keycloak login roundtrip
 *  and the Terms-of-Use gate — and both have to hand the user back afterwards.
 *  Deep links are why it matters: a Slack/Telegram bind link carries a one-shot
 *  `?flow=`, so losing the target costs the user another bind command. */

/** One slot per interstitial, so a login inside the Terms gate (or the reverse)
 *  can't clobber the other's destination. */
const SLOTS = {
  login: "platform-auth-return",
  terms: "platform-terms-return",
} as const;

export type Interstitial = keyof typeof SLOTS;

/** Interstitials are never destinations: returning to one re-enters the gate or
 *  replays a spent OIDC code. */
const INTERSTITIAL_PATHS = ["/auth/callback", "/terms"];

export interface LocationLike {
  pathname: string;
  search: string;
  hash: string;
}

/** The sessionStorage surface used here — a narrow shape keeps it substitutable. */
export interface ReturnPathStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Stored values are untrusted on the way out: only same-origin paths pass. */
export function isSafeReturnPath(value: string): boolean {
  // Browsers drop tab/LF/CR while parsing, so "/<tab>/host" is protocol-relative
  // after the fact — validate what the browser will act on, not the raw text.
  const parsed = value.replace(/[\t\n\r]/g, "");
  // "//host" and "/\host" are protocol-relative URLs, not paths.
  if (!parsed.startsWith("/") || /^\/[/\\]/.test(parsed)) return false;
  return !INTERSTITIAL_PATHS.includes(parsed.split(/[?#]/)[0]!);
}

/** The location as a return path, or null when it isn't a destination. */
export function toReturnPath(loc: LocationLike): string | null {
  const path = `${loc.pathname}${loc.search}${loc.hash}`;
  return isSafeReturnPath(path) ? path : null;
}

export function rememberReturnPath(
  which: Interstitial,
  loc: LocationLike = window.location,
  store: ReturnPathStore = sessionStorage,
): void {
  const path = toReturnPath(loc);
  // Clearing on a non-destination stops a stale target resurfacing later.
  if (path) store.setItem(SLOTS[which], path);
  else store.removeItem(SLOTS[which]);
}

/** Reads and clears the stashed destination — one-shot, dashboard as fallback. */
export function takeReturnPath(
  which: Interstitial,
  store: ReturnPathStore = sessionStorage,
): string {
  const stashed = store.getItem(SLOTS[which]);
  store.removeItem(SLOTS[which]);
  if (!stashed) return "/";
  if (isSafeReturnPath(stashed)) return stashed;
  console.warn(`[return-path] ignoring unusable ${which} return:`, stashed);
  return "/";
}
