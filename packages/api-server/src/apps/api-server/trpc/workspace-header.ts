import { TRPCError } from "@trpc/server";
import {
  WORKSPACE_REFUSED_MESSAGE,
  workspaceIdSchema,
  type UserIdentity,
  type WorkspaceAccess,
} from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import type { WorkspaceAccessResolver } from "../../../modules/workspaces/index.js";

export const WORKSPACE_HEADER = "x-platform-workspace";

export async function resolveRequestedWorkspace(
  resolver: WorkspaceAccessResolver,
  user: UserIdentity,
  requested: unknown,
): Promise<WorkspaceAccess | undefined> {
  if (requested === undefined || requested === null || requested === "") {
    return undefined;
  }
  const parsed = workspaceIdSchema.safeParse(requested);
  const access = parsed.success
    ? await resolver.resolve(user, parsed.data)
    : null;
  if (access === null) {
    securityLog("warn", "authz.deny", {
      category: "authz",
      actor: user.sub,
      actorKind: "user",
      result: "failure",
      reason: "workspace-not-member",
      target: typeof requested === "string" ? requested : undefined,
    });
    throw new TRPCError({
      code: "FORBIDDEN",
      message: WORKSPACE_REFUSED_MESSAGE,
    });
  }
  return access;
}
