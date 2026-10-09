import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  WorkspacesService,
} from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import type { WorkspacesRepository } from "../infrastructure/workspaces-repository.js";

export function createWorkspacesService(deps: {
  repo: WorkspacesRepository;
  actorSub: string;
  actorEmail: string | undefined;
}): WorkspacesService {
  function requireEmail(): string {
    if (!deps.actorEmail) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "workspaces need a login with an email address",
      });
    }
    return deps.actorEmail;
  }

  async function requireRole(
    workspaceId: string,
    allowed: readonly WorkspaceRole[],
  ): Promise<void> {
    const role = await deps.repo.roleOf(workspaceId, requireEmail());
    if (role === null) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "workspace not found",
      });
    }
    if (!allowed.includes(role)) {
      securityLog("warn", "authz.deny", {
        category: "authz",
        actor: deps.actorSub,
        actorKind: "user",
        result: "failure",
        reason: "workspace-role",
        target: workspaceId,
        detail: { role, allowed },
      });
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "only a workspace admin can change members",
      });
    }
  }

  async function keepOneAdmin(workspaceId: string, email: string) {
    const current = await deps.repo.roleOf(workspaceId, email);
    if (current !== "admin") return;
    if ((await deps.repo.countAdmins(workspaceId)) <= 1) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "a workspace needs at least one admin",
      });
    }
  }

  return {
    list(): Promise<Workspace[]> {
      return deps.actorEmail
        ? deps.repo.listForEmail(deps.actorEmail)
        : Promise.resolve([]);
    },

    async create(name) {
      const adminEmail = requireEmail();
      const id = randomUUID();
      await deps.repo.create({
        id,
        name,
        createdBy: deps.actorSub,
        adminEmail,
      });
      return { id, name, role: "admin" };
    },

    async members(workspaceId): Promise<WorkspaceMember[]> {
      await requireRole(workspaceId, ["admin", "editor", "reader"]);
      return deps.repo.members(workspaceId);
    },

    async setMember(workspaceId, email, role) {
      await requireRole(workspaceId, ["admin"]);
      if (role !== "admin") await keepOneAdmin(workspaceId, email);
      await deps.repo.upsertMember({
        workspaceId,
        email,
        role,
        addedBy: deps.actorSub,
      });
      return deps.repo.members(workspaceId);
    },

    async removeMember(workspaceId, email) {
      await requireRole(workspaceId, ["admin"]);
      await keepOneAdmin(workspaceId, email);
      await deps.repo.removeMember(workspaceId, email);
      return deps.repo.members(workspaceId);
    },
  };
}
