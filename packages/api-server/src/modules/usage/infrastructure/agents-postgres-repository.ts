import { and, eq, isNull, agents, sql, type Db } from "db";
import type { SubPseudonymizer } from "../../../core/sub-pseudonymizer.js";
import type { AgentRegistryRow } from "../domain/types.js";

const CLEARED_RUNTIME_STATE = {
  runtimeProtocolVersion: null,
  runtimeCapabilities: null,
  runtimeLastHelloAt: null,
  runtimeAgentVersion: null,
  harnessConfigSnapshot: null,
  skillsSnapshot: null,
};

export function upsertAgent(
  db: Db,
  pseudo: SubPseudonymizer,
  opts: { resetRuntimeState?: boolean } = {},
) {
  return async (row: AgentRegistryRow): Promise<void> => {
    const ownerSub = pseudo.hashSub(row.ownerSub);
    await db
      .insert(agents)
      .values({ ...row, ownerSub })
      .onConflictDoUpdate({
        target: agents.id,
        set: {
          ownerSub,
          deletedAt: null,
          ...(opts.resetRuntimeState ? CLEARED_RUNTIME_STATE : {}),
        },
      });
  };
}

export function listAgentIdsByOwner(db: Db, pseudo: SubPseudonymizer) {
  return async (rawSub: string): Promise<string[]> => {
    const rows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.ownerSub, pseudo.hashSub(rawSub)));
    return rows.map((r) => r.id);
  };
}

export function listLiveAgentIds(db: Db) {
  return async (): Promise<string[]> => {
    const rows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(isNull(agents.deletedAt));
    return rows.map((r) => r.id);
  };
}

export function markAgentDeleted(db: Db) {
  return async (id: string): Promise<void> => {
    await db
      .update(agents)
      .set({ deletedAt: sql`NOW()`, ...CLEARED_RUNTIME_STATE })
      .where(and(eq(agents.id, id), isNull(agents.deletedAt)));
  };
}
