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

export function markAgentDeleted(db: Db) {
  return async (id: string): Promise<void> => {
    await db
      .update(agents)
      .set({ deletedAt: sql`NOW()` })
      .where(eq(agents.id, id));
  };
}
