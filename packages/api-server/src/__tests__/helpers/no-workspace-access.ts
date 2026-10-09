import type { WorkspaceAccessResolver } from "../../modules/workspaces/index.js";

export const noWorkspaceAccess: WorkspaceAccessResolver = {
  resolve: async () => null,
  canReachOwner: async () => false,
};
