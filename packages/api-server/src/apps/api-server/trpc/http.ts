import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { ApiContext, UserIdentity } from "api-server-api";
import { appRouter, markTermsProven } from "api-server-api/router";
import type { Context } from "hono";
import type { ApiVariables } from "../deps.js";

export function createTrpcHttpHandler(deps: {
  composeApiContext: (user: UserIdentity, surface: string) => ApiContext;
}) {
  return (
    c: Context<{
      Variables: ApiVariables;
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
