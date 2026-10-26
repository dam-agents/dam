import type { FullAccessChoice, GithubAccess } from "./github-access.js";
import {
  type PermissionLevel,
  writePermissions,
  writeRepositoryIds,
} from "./github-app-scope-fields.js";

export interface UserTokenScopeChoice {
  targetId: number;
  repositoryIds?: string;
  permissions?: string;
}

export function userTokenScopeChoice(selection: {
  access: GithubAccess;
  targetId: number | null;
  repositoryIds: ReadonlySet<number>;
  permissions: Record<string, PermissionLevel>;
}): FullAccessChoice | UserTokenScopeChoice | null {
  if (selection.access === "full") return { fullAccess: true };
  if (selection.targetId === null) return null;
  const repositoryIds = writeRepositoryIds([...selection.repositoryIds]);
  const permissions = writePermissions(selection.permissions);
  return {
    targetId: selection.targetId,
    ...(repositoryIds ? { repositoryIds } : {}),
    ...(permissions ? { permissions } : {}),
  };
}
