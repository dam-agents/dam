import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { ApiContext, UserIdentity } from "api-server-api";
import { appRouter, markTermsProven } from "api-server-api/router";
import { Hono } from "hono";
import {
  limitRequestBody,
  MAX_TRPC_BATCH_SIZE,
  MAX_USER_REQUEST_BODY_BYTES,
} from "../../../core/request-body-bounds.js";
import type { ApiVariables } from "../deps.js";
import { logInternalError } from "./log-internal-error.js";

export function createTrpcHttpRoutes(deps: {
  composeApiContext: (user: UserIdentity, surface: string) => ApiContext;
}) {
  return new Hono<{ Variables: ApiVariables }>()
    .use(limitRequestBody(MAX_USER_REQUEST_BODY_BYTES))
    .all("/*", (c) =>
      fetchRequestHandler({
        endpoint: "/api/trpc",
        req: c.req.raw,
        router: appRouter,
        maxBatchSize: MAX_TRPC_BATCH_SIZE,
        onError: logInternalError,
        createContext: () => {
          const ctx = deps.composeApiContext(c.get("user"), c.get("surface"));
          markTermsProven(ctx);
          return ctx;
        },
      }),
    );
}
