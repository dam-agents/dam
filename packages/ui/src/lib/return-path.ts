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
  origin: string;
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

/**
 * Resolve an untrusted destination the way the browser will, or null when it
 * must not be navigated to.
 *
 * The URL parser is the authority, and everything below hands back *its* output
 * rather than the caller's text. That is the point: the parser drops control
 * characters, trims C0 and spaces, collapses dot segments and percent-encodes,
 * so any check against the raw string judges something the browser has already
 * rewritten — which is how `/<tab>/host` reached another origin and
 * `/a/../terms` reached the gate. There is no verdict-only entry point for the
 * same reason: validating one string and navigating to another is the bug.
 */
function resolve(value: string, origin: string): URL | null {
  // Every parse sits inside the guard: this runs at boot and on the way out of
  // the Terms gate, so an unparseable value has to read as "no destination"
  // rather than throw into either path.
  try {
    const base = new URL(origin);
    const url = new URL(value, base);
    if (url.origin !== base.origin) return null;
    // Schemes without a hierarchical path (blob:, data:) can still report our
    // origin, and their "pathname" is not a path.
    if (!url.pathname.startsWith("/")) return null;
    if (INTERSTITIAL_PATHS.includes(url.pathname)) return null;
    // The output has to survive being used as a reference again, because that is
    // what callers do with it. A resolved path can begin with "//" — dot segments
    // collapse "/a/..//host" to "//host" — which reads as another origin the
    // second time around, or fails to parse at all. Re-resolving proves the
    // verdict instead of arguing it.
    return new URL(pathOf(url), base).href === url.href ? url : null;
  } catch {
    return null;
  }
}

function pathOf(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The whole destination — path, query and fragment — canonicalized. */
export function resolveReturnPath(
  value: string,
  origin: string,
): string | null {
  const url = resolve(value, origin);
  return url ? pathOf(url) : null;
}

/** The path alone, for routing: a query or fragment riding along in a stored
 *  value would otherwise be read as part of an id or tab. */
export function resolveReturnPathname(
  value: string,
  origin: string,
): string | null {
  return resolve(value, origin)?.pathname ?? null;
}

export function rememberReturnPath(
  which: Interstitial,
  loc: LocationLike = window.location,
  store: ReturnPathStore = sessionStorage,
): void {
  const path = resolveReturnPath(
    `${loc.pathname}${loc.search}${loc.hash}`,
    loc.origin,
  );
  // Clearing on a non-destination stops a stale target resurfacing later.
  if (path) store.setItem(SLOTS[which], path);
  else store.removeItem(SLOTS[which]);
}

/** Reads and clears the stashed destination — one-shot, dashboard as fallback.
 *  Re-resolved on the way out: the slot is attacker-writable, so what the
 *  caller navigates to is the parser's verdict, never the stored text. */
export function takeReturnPath(
  which: Interstitial,
  store: ReturnPathStore = sessionStorage,
  origin: string = window.location.origin,
): string {
  const stashed = store.getItem(SLOTS[which]);
  store.removeItem(SLOTS[which]);
  if (!stashed) return "/";
  const path = resolveReturnPath(stashed, origin);
  if (path) return path;
  console.warn(`[return-path] ignoring unusable ${which} return:`, stashed);
  return "/";
}
