import type { MiddlewareHandler } from "hono";

/** The trust-boundary dispatch for the public share origin: requests whose
 *  Host addresses the share host are handed to the self-contained viewer app
 *  and never fall through to any app route (register this before auth);
 *  everything else passes untouched. Matching is on the hostname alone —
 *  K8s Ingress host rules are port-less, and dev setups reach the cluster
 *  through remapped ports, so the port carries no routing meaning. */
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
