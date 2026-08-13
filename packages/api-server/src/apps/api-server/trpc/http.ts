import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { ApiContext, UserIdentity } from "api-server-api";
import { appRouter } from "api-server-api/router";
import type { Context } from "hono";

/** The HTTP transport of the tRPC surface (`/api/trpc`) — sibling of the WS
 *  transport in `trpc-ws.ts`, serving the same router. Stateless by design:
 *  auth and the terms gate already ran in the Hono middleware chain, and the
 *  per-user context is composed fresh per request. */
export function createTrpcHttpHandler(deps: {
  composeApiContext: (user: UserIdentity) => ApiContext;
}) {
  return (c: Context<{ Variables: { user: UserIdentity; roles: string[] } }>) =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: () => deps.composeApiContext(c.get("user")),
    });
}
