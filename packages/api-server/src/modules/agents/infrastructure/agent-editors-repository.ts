import type { Db } from "db";
import { agentEditors, and, asc, eq, inArray } from "db";

export interface EditorListChange {
  editors: string[];
  added: string[];
  removed: string[];
}

export interface AgentEditorsRepository {
  list(agentId: string): Promise<string[]>;
  listMany(agentIds: string[]): Promise<Map<string, string[]>>;
  agentIdsFor(email: string): Promise<string[]>;
  replace(agentId: string, emails: string[]): Promise<EditorListChange>;
  remove(agentId: string, email: string): Promise<boolean>;
  deleteForAgent(agentId: string): Promise<string[]>;
  listAgentIds(): Promise<string[]>;
}

export function createAgentEditorsRepository(db: Db): AgentEditorsRepository {
  const editorsOf = async (tx: Pick<Db, "select">, agentId: string) =>
    (
      await tx
        .select({ email: agentEditors.email })
        .from(agentEditors)
        .where(eq(agentEditors.agentId, agentId))
        .orderBy(asc(agentEditors.addedAt), asc(agentEditors.email))
    ).map((r) => r.email);

  return {
    list: (agentId) => editorsOf(db, agentId),

    async listMany(agentIds) {
      const map = new Map<string, string[]>();
      for (const id of agentIds) map.set(id, []);
      if (agentIds.length === 0) return map;
      const rows = await db
        .select({ agentId: agentEditors.agentId, email: agentEditors.email })
        .from(agentEditors)
        .where(inArray(agentEditors.agentId, agentIds))
        .orderBy(asc(agentEditors.addedAt), asc(agentEditors.email));
      for (const r of rows) map.get(r.agentId)?.push(r.email);
      return map;
    },

    async agentIdsFor(email) {
      const rows = await db
        .select({ agentId: agentEditors.agentId })
        .from(agentEditors)
        .where(eq(agentEditors.email, email));
      return rows.map((r) => r.agentId);
    },

    async replace(agentId, emails) {
      return db.transaction(async (tx) => {
        const existing = await editorsOf(tx, agentId);
        const removed = existing.filter((e) => !emails.includes(e));
        const added = emails.filter((e) => !existing.includes(e));
        if (removed.length > 0)
          await tx
            .delete(agentEditors)
            .where(
              and(
                eq(agentEditors.agentId, agentId),
                inArray(agentEditors.email, removed),
              ),
            );
        if (added.length > 0)
          await tx
            .insert(agentEditors)
            .values(added.map((email) => ({ agentId, email })))
            .onConflictDoNothing();
        return { editors: await editorsOf(tx, agentId), added, removed };
      });
    },

    async remove(agentId, email) {
      const rows = await db
        .delete(agentEditors)
        .where(
          and(eq(agentEditors.agentId, agentId), eq(agentEditors.email, email)),
        )
        .returning({ email: agentEditors.email });
      return rows.length > 0;
    },

    async deleteForAgent(agentId) {
      const rows = await db
        .delete(agentEditors)
        .where(eq(agentEditors.agentId, agentId))
        .returning({ email: agentEditors.email });
      return rows.map((r) => r.email);
    },

    async listAgentIds() {
      const rows = await db
        .selectDistinct({ agentId: agentEditors.agentId })
        .from(agentEditors);
      return rows.map((r) => r.agentId);
    },
  };
}
