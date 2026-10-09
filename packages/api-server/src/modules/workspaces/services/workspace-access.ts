import {
  workspaceIdOfPrincipal,
  workspacePrincipal,
  workspaceRoleScopes,
  type UserIdentity,
  type WorkspaceAccess,
} from "api-server-api";
import type { WorkspacesRepository } from "../infrastructure/workspaces-repository.js";

export interface WorkspaceAccessResolver {
  resolve(
    user: UserIdentity,
    workspaceId: string,
  ): Promise<WorkspaceAccess | null>;
  canReachOwner(user: UserIdentity, owner: string): Promise<boolean>;
}

export function createWorkspaceAccessResolver(
  repo: WorkspacesRepository,
): WorkspaceAccessResolver {
  async function resolve(
    user: UserIdentity,
    workspaceId: string,
  ): Promise<WorkspaceAccess | null> {
    if (user.keyId !== undefined || !user.email) return null;
    const role = await repo.roleOf(workspaceId, user.email);
    if (role === null) return null;
    return {
      id: workspaceId,
      principal: workspacePrincipal(workspaceId),
      role,
    };
  }

  return {
    resolve,
    async canReachOwner(user, owner) {
      if (owner === user.sub) return true;
      const workspaceId = workspaceIdOfPrincipal(owner);
      return (
        workspaceId !== null && (await resolve(user, workspaceId)) !== null
      );
    },
  };
}

export function scopeToWorkspace(
  user: UserIdentity,
  access: WorkspaceAccess,
): UserIdentity {
  const allowed = new Set(workspaceRoleScopes(access.role));
  return { ...user, scopes: user.scopes.filter((s) => allowed.has(s)) };
}
