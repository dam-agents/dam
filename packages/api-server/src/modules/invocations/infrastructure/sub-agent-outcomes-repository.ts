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
  claimUndelivered(limit: number): Promise<InvocationRow[]>;
  release(ids: string[]): Promise<void>;
  markWoken(ids: string[]): Promise<void>;
  listDeliveredUnwoken(limit: number): Promise<InvocationRow[]>;
}

const undeliveredToolOutcome = () =>
  and(
    eq(invocationsTable.origin, "tool"),
    inArray(invocationsTable.status, ["done", "failed"]),
    isNull(invocationsTable.deliveredAt),
  );

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
        .set({ deliveredAt: now, wokeAt: now })
        .where(
          and(
            eq(invocationsTable.driverAgentId, driverAgentId),
            inArray(invocationsTable.id, ids),
            isNull(invocationsTable.deliveredAt),
          ),
        );
    },

    async claimUndelivered(limit) {
      const oldest = await db
        .select({ id: invocationsTable.id })
        .from(invocationsTable)
        .where(
          and(
            undeliveredToolOutcome(),
            sql`(${invocationsTable.awaitedUntil} is null or ${invocationsTable.awaitedUntil} < now())`,
          ),
        )
        .orderBy(invocationsTable.completedAt)
        .limit(limit);
      if (oldest.length === 0) return [];
      const rows = await db
        .update(invocationsTable)
        .set({ deliveredAt: new Date() })
        .where(
          and(
            undeliveredToolOutcome(),
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
        .set({ deliveredAt: null })
        .where(
          and(
            inArray(invocationsTable.id, ids),
            isNull(invocationsTable.wokeAt),
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
            eq(invocationsTable.origin, "tool"),
            isNotNull(invocationsTable.deliveredAt),
            isNull(invocationsTable.wokeAt),
          ),
        )
        .limit(limit);
      return rows.map(toRow);
    },
  };
}
