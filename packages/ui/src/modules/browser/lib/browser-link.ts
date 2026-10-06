import { addressUrl } from "./stream.js";

export const BROWSER_LINK_PREFIX = "platform://browser?url=";

export function parseBrowserLink(href: string | undefined): string | null {
  if (!href?.startsWith(BROWSER_LINK_PREFIX)) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(href.slice(BROWSER_LINK_PREFIX.length));
  } catch {
    return null;
  }
  const candidate = addressUrl(raw);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function browserLinkLabel(url: string): string {
  const { host, pathname } = new URL(url);
  return `${host}${pathname === "/" ? "" : pathname}`;
}

const BROWSER_LINK_IN_TEXT = /\((platform:\/\/browser\?url=[^)\s]+)\)/g;

export function browserLinksIn(text: string): string[] {
  const urls: string[] = [];
  for (const match of text.matchAll(BROWSER_LINK_IN_TEXT)) {
    const url = parseBrowserLink(match[1]);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}
