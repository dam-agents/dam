import type { Context } from "hono";

export const X_ROBOTS_TAG = "noindex, nofollow, noarchive";

export const ROBOTS_TXT_ROUTE = "/robots.txt";

export function robotsTxt(c: Context): Response {
  return c.text("User-agent: *\nDisallow: /\n");
}
