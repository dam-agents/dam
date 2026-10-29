import type { Context } from "hono";

// Share and content hosts serve user content, which no search engine may index.
export const X_ROBOTS_TAG = "noindex, nofollow, noarchive";

export const ROBOTS_TXT_ROUTE = "/robots.txt";

export function robotsTxt(c: Context): Response {
  return c.text("User-agent: *\nDisallow: /\n");
}
