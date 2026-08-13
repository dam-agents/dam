const SLOTS = {
  login: "platform-auth-return",
  terms: "platform-terms-return",
} as const;

export type Interstitial = keyof typeof SLOTS;

const INTERSTITIAL_PATHS = ["/auth/callback", "/terms"];

export interface LocationLike {
  origin: string;
  pathname: string;
  search: string;
  hash: string;
}

export interface ReturnPathStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolve(value: string, origin: string): URL | null {
  try {
    const base = new URL(origin);
    const url = new URL(value, base);
    if (url.origin !== base.origin) return null;
    if (!url.pathname.startsWith("/")) return null;
    if (INTERSTITIAL_PATHS.includes(url.pathname)) return null;
    return new URL(pathOf(url), base).href === url.href ? url : null;
  } catch {
    return null;
  }
}

function pathOf(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function resolveReturnPath(
  value: string,
  origin: string,
): string | null {
  const url = resolve(value, origin);
  return url ? pathOf(url) : null;
}

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
  if (path) store.setItem(SLOTS[which], path);
  else store.removeItem(SLOTS[which]);
}

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
