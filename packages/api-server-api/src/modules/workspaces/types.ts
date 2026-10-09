import type { z } from "zod";
import type { Scope } from "../api-keys/types.js";
import type { workspaceRoleSchema } from "./schemas.js";

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export interface Workspace {
  id: string;
  name: string;
  role: WorkspaceRole;
}

export interface WorkspaceMember {
  email: string;
  role: WorkspaceRole;
  addedAt: string;
}

export interface WorkspaceAccess {
  id: string;
  principal: string;
  role: WorkspaceRole;
}

export interface WorkspacesService {
  list(): Promise<Workspace[]>;
  create(name: string): Promise<Workspace>;
  members(workspaceId: string): Promise<WorkspaceMember[]>;
  setMember(
    workspaceId: string,
    email: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMember[]>;
  removeMember(workspaceId: string, email: string): Promise<WorkspaceMember[]>;
}

const WORKSPACE_PRINCIPAL_PREFIX = "ws-";

export function workspacePrincipal(workspaceId: string): string {
  return `${WORKSPACE_PRINCIPAL_PREFIX}${workspaceId}`;
}

export function workspaceIdOfPrincipal(owner: string): string | null {
  return owner.startsWith(WORKSPACE_PRINCIPAL_PREFIX)
    ? owner.slice(WORKSPACE_PRINCIPAL_PREFIX.length)
    : null;
}

const ROLE_SCOPES: Record<WorkspaceRole, readonly Scope[]> = {
  reader: ["agents:read", "agents:operate"],
  editor: [
    "agents:read",
    "agents:operate",
    "agents:manage",
    "credentials:read",
  ],
  admin: [
    "agents:read",
    "agents:operate",
    "agents:manage",
    "credentials:read",
    "credentials:manage",
  ],
};

export function workspaceRoleScopes(role: WorkspaceRole): readonly Scope[] {
  return ROLE_SCOPES[role];
}
export const WORKSPACE_REFUSED_MESSAGE = "not a member of this workspace";
