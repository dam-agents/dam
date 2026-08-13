import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { markTermsProven } from "api-server-api";
import type { ApiContext, UserIdentity } from "api-server-api";
import { appRouter } from "api-server-api/router";
import type { Context } from "hono";

export function createTrpcHttpHandler(deps: {
  composeApiContext: (user: UserIdentity) => ApiContext;
}) {
  return (c: Context<{ Variables: { user: UserIdentity; roles: string[] } }>) =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: () => {
        const ctx = deps.composeApiContext(c.get("user"));
        markTermsProven(ctx);
        return ctx;
      },
    });
}
