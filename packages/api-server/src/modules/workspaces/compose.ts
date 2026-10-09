import type { Db } from "db";
import type { UserIdentity, WorkspacesService } from "api-server-api";
import { createWorkspacesRepository } from "./infrastructure/workspaces-repository.js";
import {
  createWorkspaceAccessResolver,
  type WorkspaceAccessResolver,
} from "./services/workspace-access.js";
import { createWorkspacesService } from "./services/workspaces-service.js";

export function composeWorkspacesModule(db: Db): {
  access: WorkspaceAccessResolver;
  serviceFor(user: UserIdentity): WorkspacesService;
} {
  const repo = createWorkspacesRepository(db);
  return {
    access: createWorkspaceAccessResolver(repo),
    serviceFor: (user) =>
      createWorkspacesService({
        repo,
        actorSub: user.sub,
        actorEmail: user.keyId === undefined ? user.email : undefined,
      }),
  };
}
