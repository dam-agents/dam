import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type Db,
  invocations as invocationsTable,
} from "db";
import { toRow, type InvocationRow } from "./invocations-repository.js";

export interface SubAgentOutcomesRepository {
  markAwaited(driverAgentId: string, ids: string[], until: Date): Promise<void>;
  markCollected(driverAgentId: string, ids: string[]): Promise<void>;
  claimUndelivered(limit: number, until: Date): Promise<InvocationRow[]>;
  release(ids: string[]): Promise<void>;
  markDelivered(ids: string[]): Promise<void>;
  markWoken(ids: string[]): Promise<void>;
  listDeliveredUnwoken(limit: number): Promise<InvocationRow[]>;
}

const terminalToolOutcome = () =>
  and(
    eq(invocationsTable.origin, "tool"),
    inArray(invocationsTable.status, ["done", "failed"]),
  );

const claimable = () =>
  and(
    terminalToolOutcome(),
    isNull(invocationsTable.deliveredAt),
    sql`(${invocationsTable.awaitedUntil} is null or ${invocationsTable.awaitedUntil} < now())`,
    sql`(${invocationsTable.claimedUntil} is null or ${invocationsTable.claimedUntil} < now())`,
  );

/**
 * UNIT_BOUNDARY_DESCRIPTION: The delivery bookkeeping on a tool-spawned
 * Invocation's row. A claim is a lease, not a delivery: `claimedUntil` holds the
 * row for one tick, and only the turn being written sets `deliveredAt`, so a
 * server that dies between the two leaves a row the next tick claims again.
 */
export function createSubAgentOutcomesRepository(
  db: Db,
): SubAgentOutcomesRepository {
  return {
    async markAwaited(driverAgentId, ids, until) {
      if (ids.length === 0) return;
      await db
        .update(invocationsTable)
        .set({ awaitedUntil: until })
        .where(
          and(
            eq(invocationsTable.driverAgentId, driverAgentId),
            inArray(invocationsTable.id, ids),
          ),
        );
    },

    async markCollected(driverAgentId, ids) {
      if (ids.length === 0) return;
      const now = new Date();
      await db
        .update(invocationsTable)
        .set({ deliveredAt: now, wokeAt: now, claimedUntil: null })
        .where(
          and(
            eq(invocationsTable.driverAgentId, driverAgentId),
            inArray(invocationsTable.id, ids),
            isNull(invocationsTable.deliveredAt),
          ),
        );
    },

    async claimUndelivered(limit, until) {
      const oldest = await db
        .select({ id: invocationsTable.id })
        .from(invocationsTable)
        .where(claimable())
        .orderBy(invocationsTable.completedAt)
        .limit(limit);
      if (oldest.length === 0) return [];
      const rows = await db
        .update(invocationsTable)
        .set({ claimedUntil: until })
        .where(
          and(
            claimable(),
            inArray(
              invocationsTable.id,
              oldest.map((r) => r.id),
            ),
          ),
        )
        .returning();
      return rows.map(toRow);
    },

    async release(ids) {
      if (ids.length === 0) return;
      await db
        .update(invocationsTable)
        .set({ claimedUntil: null })
        .where(
          and(
            inArray(invocationsTable.id, ids),
            isNull(invocationsTable.deliveredAt),
          ),
        );
    },

    async markDelivered(ids) {
      if (ids.length === 0) return;
      await db
        .update(invocationsTable)
        .set({ deliveredAt: new Date(), claimedUntil: null })
        .where(
          and(
            inArray(invocationsTable.id, ids),
            isNull(invocationsTable.deliveredAt),
          ),
        );
    },

    async markWoken(ids) {
      if (ids.length === 0) return;
      await db
        .update(invocationsTable)
        .set({ wokeAt: new Date() })
        .where(inArray(invocationsTable.id, ids));
    },

    async listDeliveredUnwoken(limit) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(
          and(
            terminalToolOutcome(),
            isNotNull(invocationsTable.deliveredAt),
            isNull(invocationsTable.wokeAt),
          ),
        )
        .limit(limit);
      return rows.map(toRow);
    },
  };
}
