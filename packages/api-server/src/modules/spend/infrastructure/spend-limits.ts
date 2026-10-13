import { randomUUID } from "node:crypto";
import { and, eq, sql, spendLimitExtensions, spendLimits, type Db } from "db";
import type { LimitScope, SpendLimit } from "../domain/limits.js";
import type { SpendUnit } from "../domain/units.js";

export interface SpendLimits {
  forAgent(agentId: string, day: string): Promise<SpendLimit[]>;
  set(input: {
    ownerSub: string;
    scope: LimitScope;
    unit: SpendUnit;
    amountMicros: number;
  }): Promise<void>;
  clear(ownerSub: string, scope: LimitScope): Promise<void>;
  extend(limitId: string, day: string, extensions: number): Promise<void>;
  deleteForAgent(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

export function createSpendLimits(db: Db): SpendLimits {
  const scopeIs = (ownerSub: string, scope: LimitScope) =>
    and(
      eq(spendLimits.ownerSub, ownerSub),
      eq(spendLimits.scope, scope.kind),
      eq(spendLimits.agentId, scope.agentId),
    );

  return {
    async forAgent(agentId, day) {
      const rows = await db
        .select({
          id: spendLimits.id,
          ownerSub: spendLimits.ownerSub,
          agentId: spendLimits.agentId,
          unit: spendLimits.unit,
          amountMicros: spendLimits.amountMicros,
          extensions: sql<number>`coalesce(${spendLimitExtensions.extensions}, 0)`,
        })
        .from(spendLimits)
        .leftJoin(
          spendLimitExtensions,
          and(
            eq(spendLimitExtensions.limitId, spendLimits.id),
            eq(spendLimitExtensions.day, day),
          ),
        )
        .where(
          and(eq(spendLimits.scope, "agent"), eq(spendLimits.agentId, agentId)),
        );
      return rows.map((row) => ({
        id: row.id,
        ownerSub: row.ownerSub,
        scope: { kind: "agent", agentId: row.agentId ?? agentId },
        unit: row.unit as SpendUnit,
        amountMicros: row.amountMicros,
        extensions: Number(row.extensions),
      }));
    },

    async set({ ownerSub, scope, unit, amountMicros }) {
      await db
        .insert(spendLimits)
        .values({
          id: randomUUID(),
          ownerSub,
          scope: scope.kind,
          agentId: scope.agentId,
          connectionId: null,
          unit,
          amountMicros,
        })
        .onConflictDoUpdate({
          target: [
            spendLimits.ownerSub,
            spendLimits.scope,
            spendLimits.agentId,
            spendLimits.connectionId,
          ],
          set: { unit, amountMicros, updatedAt: sql`now()` },
        });
    },

    async clear(ownerSub, scope) {
      await db.delete(spendLimits).where(scopeIs(ownerSub, scope));
    },

    async extend(limitId, day, extensions) {
      await db.execute(sql`
        INSERT INTO ${spendLimitExtensions} (limit_id, day, extensions)
        SELECT ${spendLimits.id}, ${day}::date, ${extensions}::integer
        FROM ${spendLimits}
        WHERE ${spendLimits.id} = ${limitId}
        ON CONFLICT (limit_id, day) DO UPDATE
        SET extensions = greatest(${spendLimitExtensions.extensions}, excluded.extensions)
      `);
    },

    async deleteForAgent(agentId) {
      await db.delete(spendLimits).where(eq(spendLimits.agentId, agentId));
    },

    async listAgentIds() {
      const rows = await db
        .selectDistinct({ agentId: spendLimits.agentId })
        .from(spendLimits);
      return rows.flatMap((row) => (row.agentId ? [row.agentId] : []));
    },
  };
}
