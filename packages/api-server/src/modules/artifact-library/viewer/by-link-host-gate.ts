import type { MiddlewareHandler } from "hono";

type Fetchable = { fetch: (req: Request) => Response | Promise<Response> };

export interface ByLinkHost {
  baseUrl: string;
  app: Fetchable;
}

export function createByLinkHostGate(hosts: {
  share: ByLinkHost;
  content: ByLinkHost;
}): MiddlewareHandler {
  const byHostname = new Map<string, Fetchable>();
  for (const host of [hosts.share, hosts.content]) {
    const hostname = new URL(host.baseUrl).hostname.toLowerCase();
    if (byHostname.has(hostname))
      throw new Error("Share and content hosts must use different hostnames");
    byHostname.set(hostname, host.app);
  }
  return async (c, next) => {
    const hostname = c.req.header("host")?.split(":")[0]?.toLowerCase();
    const app = hostname === undefined ? undefined : byHostname.get(hostname);
    if (app) return app.fetch(c.req.raw);
    return next();
  };
}
