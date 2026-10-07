import {
  type PermissionLevel,
  writePermissions,
  writeRepositoryIds,
} from "./github-app-scope-fields.js";

export const EVERY_ACCOUNT = "every-account";

export function userTokenScopePayload(
  id: string,
  selection: {
    targetId: number | null;
    repositoryIds: ReadonlySet<number>;
    permissions: Record<string, PermissionLevel>;
  },
): {
  id: string;
  targetId?: number;
  repositoryIds?: string;
  permissions?: string;
} {
  if (selection.targetId === null) return { id };
  return {
    id,
    targetId: selection.targetId,
    repositoryIds: writeRepositoryIds([...selection.repositoryIds]),
    permissions: writePermissions(selection.permissions),
  };
}
