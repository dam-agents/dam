import { and, asc, eq, sql, type Db, workspaceMembers, workspaces } from "db";
import type { Workspace, WorkspaceMember, WorkspaceRole } from "api-server-api";

export interface WorkspacesRepository {
  listForEmail(email: string): Promise<Workspace[]>;
  create(input: {
    id: string;
    name: string;
    createdBy: string;
    adminEmail: string;
  }): Promise<void>;
  roleOf(workspaceId: string, email: string): Promise<WorkspaceRole | null>;
  members(workspaceId: string): Promise<WorkspaceMember[]>;
  upsertMember(input: {
    workspaceId: string;
    email: string;
    role: WorkspaceRole;
    addedBy: string;
  }): Promise<void>;
  removeMember(workspaceId: string, email: string): Promise<void>;
  countAdmins(workspaceId: string): Promise<number>;
}

export function createWorkspacesRepository(db: Db): WorkspacesRepository {
  return {
    async listForEmail(email) {
      return db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          role: workspaceMembers.role,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(eq(workspaceMembers.email, email))
        .orderBy(asc(workspaces.name));
    },

    async create({ id, name, createdBy, adminEmail }) {
      await db.transaction(async (tx) => {
        await tx.insert(workspaces).values({ id, name, createdBy });
        await tx.insert(workspaceMembers).values({
          workspaceId: id,
          email: adminEmail,
          role: "admin",
          addedBy: createdBy,
        });
      });
    },

    async roleOf(workspaceId, email) {
      const [row] = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.email, email),
          ),
        );
      return row?.role ?? null;
    },

    async members(workspaceId) {
      const rows = await db
        .select({
          email: workspaceMembers.email,
          role: workspaceMembers.role,
          addedAt: workspaceMembers.addedAt,
        })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId))
        .orderBy(asc(workspaceMembers.email));
      return rows.map((r) => ({ ...r, addedAt: r.addedAt.toISOString() }));
    },

    async upsertMember({ workspaceId, email, role, addedBy }) {
      await db
        .insert(workspaceMembers)
        .values({ workspaceId, email, role, addedBy })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.email],
          set: { role },
        });
    },

    async removeMember(workspaceId, email) {
      await db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.email, email),
          ),
        );
    },

    async countAdmins(workspaceId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.role, "admin"),
          ),
        );
      return row?.n ?? 0;
    },
  };
}
