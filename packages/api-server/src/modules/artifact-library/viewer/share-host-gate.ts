import type { MiddlewareHandler } from "hono";

export function createShareHostGate(
  shareBaseUrl: string,
  viewer: { fetch: (req: Request) => Response | Promise<Response> },
): MiddlewareHandler {
  const shareHostname = new URL(shareBaseUrl).hostname.toLowerCase();
  return async (c, next) => {
    const hostname = c.req.header("host")?.split(":")[0]?.toLowerCase();
    if (hostname === shareHostname) return viewer.fetch(c.req.raw);
    return next();
  };
}
