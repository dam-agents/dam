import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { ApiContext, UserIdentity } from "api-server-api";
import { appRouter, markTermsProven } from "api-server-api/router";
import type { Context } from "hono";

export function createTrpcHttpHandler(deps: {
  composeApiContext: (user: UserIdentity, surface: string) => ApiContext;
}) {
  return (
    c: Context<{
      Variables: { user: UserIdentity; roles: string[]; surface: string };
    }>,
  ) =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: () => {
        const ctx = deps.composeApiContext(c.get("user"), c.get("surface"));
        markTermsProven(ctx);
        return ctx;
      },
    });
}
