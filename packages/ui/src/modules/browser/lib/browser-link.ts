import { withScheme } from "./address.js";

export const BROWSER_LINK_PREFIX = "platform://browser?url=";
export const FRESH_LINK_MS = 2 * 60_000;

export interface BrowserLink {
  url: string;
  at: number | null;
}

export function parseBrowserLink(href: string | undefined): BrowserLink | null {
  if (!href?.startsWith(BROWSER_LINK_PREFIX)) return null;
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(href.slice("platform://browser?".length));
  } catch {
    return null;
  }
  const candidate = withScheme(query.get("url") ?? "");
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const at = Number(query.get("at"));
  return { url: url.href, at: Number.isFinite(at) && at > 0 ? at : null };
}

export function isFreshLink(link: BrowserLink, now: number): boolean {
  return link.at !== null && Math.abs(now - link.at) < FRESH_LINK_MS;
}

export function browserLinkLabel(url: string): string {
  const { host, pathname } = new URL(url);
  return `${host}${pathname === "/" ? "" : pathname}`;
}

export function mayAutoOpen(
  link: BrowserLink,
  opts: { now: number; draftOpen: boolean; alreadyOpened: boolean },
): boolean {
  return !opts.draftOpen && !opts.alreadyOpened && isFreshLink(link, opts.now);
}

export function streamPageUrl(agentId: string, token: string): string {
  return `/api/public/browser-stream/${encodeURIComponent(agentId)}/index.html?token=${encodeURIComponent(token)}`;
}

export function streamPageReload(
  agentId: string,
  shownToken: string | null,
  token: string,
): string | null {
  return token === shownToken ? null : streamPageUrl(agentId, token);
}
