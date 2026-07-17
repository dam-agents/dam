import { eq, agents, sql, type Db } from "db";
import type { SubPseudonymizer } from "../../../core/sub-pseudonymizer.js";
import type { AgentRegistryRow } from "../domain/types.js";

/** Idempotent. Resets `deleted_at` and refreshes ownerSub on conflict so a
 *  re-used agent id (collision or future deterministic naming) reflects the
 *  current K8s state instead of silently keeping the prior row's identity. */
export function upsertAgent(db: Db, pseudo: SubPseudonymizer) {
  return async (row: AgentRegistryRow): Promise<void> => {
    const ownerSub = pseudo.hashSub(row.ownerSub);
    await db
      .insert(agents)
      .values({ ...row, ownerSub })
      .onConflictDoUpdate({
        target: agents.id,
        set: { ownerSub, deletedAt: null },
      });
  };
}

/** Every agent id ever registered to `rawSub`, soft-deleted included — the
 *  historical ownership scope. Rows follow the upsert above: a re-used id
 *  belongs to its current owner, history and all. */
export function listAgentIdsByOwner(db: Db, pseudo: SubPseudonymizer) {
  return async (rawSub: string): Promise<string[]> => {
    const rows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.ownerSub, pseudo.hashSub(rawSub)));
    return rows.map((r) => r.id);
  };
}

export function markAgentDeleted(db: Db) {
  return async (id: string): Promise<void> => {
    await db
      .update(agents)
      .set({ deletedAt: sql`NOW()` })
      .where(eq(agents.id, id));
  };
}
