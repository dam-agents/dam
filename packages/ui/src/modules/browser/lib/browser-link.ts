import { addressUrl } from "./control.js";

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
  const candidate = addressUrl(query.get("url") ?? "");
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

const BROWSER_LINK_IN_TEXT = /\((platform:\/\/browser\?url=[^)\s]+)\)/g;

export function browserLinksIn(text: string): BrowserLink[] {
  const links: BrowserLink[] = [];
  for (const match of text.matchAll(BROWSER_LINK_IN_TEXT)) {
    const link = parseBrowserLink(match[1]);
    if (link && !links.some((l) => l.url === link.url && l.at === link.at))
      links.push(link);
  }
  return links;
}
