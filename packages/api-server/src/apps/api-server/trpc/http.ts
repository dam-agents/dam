import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { ApiContext, UserIdentity, WorkspaceAccess } from "api-server-api";
import { appRouter, markTermsProven } from "api-server-api/router";
import type { Context } from "hono";
import type { ApiVariables } from "../deps.js";
import type { WorkspaceAccessResolver } from "../../../modules/workspaces/index.js";
import { logInternalError } from "./log-internal-error.js";
import {
  resolveRequestedWorkspace,
  WORKSPACE_HEADER,
} from "./workspace-header.js";

export function createTrpcHttpHandler(deps: {
  composeApiContext: (
    user: UserIdentity,
    surface: string,
    workspace?: WorkspaceAccess,
  ) => ApiContext;
  workspaceAccess: WorkspaceAccessResolver;
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
      onError: logInternalError,
      createContext: async () => {
        const user = c.get("user");
        const workspace = await resolveRequestedWorkspace(
          deps.workspaceAccess,
          user,
          c.req.header(WORKSPACE_HEADER),
        );
        const ctx = deps.composeApiContext(user, c.get("surface"), workspace);
        markTermsProven(ctx);
        return ctx;
      },
    });
}
