import { randomUUID } from "node:crypto";
import {
  and,
  eq,
  isNull,
  or,
  sql,
  spendLimitExtensions,
  spendLimits,
  type Db,
} from "db";
import { match } from "ts-pattern";
import type { LimitScope, SpendLimit } from "../domain/limits.js";
import type { SpendUnit } from "../domain/units.js";

export interface SpendLimits {
  applying(
    who: { agentId: string | null; ownerSub: string },
    day: string,
  ): Promise<SpendLimit[]>;
  set(input: {
    ownerSub: string;
    scope: LimitScope;
    unit: SpendUnit;
    amountMicros: number;
  }): Promise<string>;
  clear(ownerSub: string, scope: LimitScope): Promise<string | null>;
  extend(limitId: string, day: string, extensions: number): Promise<void>;
  deleteForAgent(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

function scopeColumns(scope: LimitScope): {
  agentId: string | null;
  connectionId: string | null;
} {
  return match(scope)
    .with({ kind: "agent" }, (s) => ({
      agentId: s.agentId,
      connectionId: null,
    }))
    .with({ kind: "owner" }, () => ({ agentId: null, connectionId: null }))
    .with({ kind: "connection" }, (s) => ({
      agentId: s.agentId,
      connectionId: s.connectionId,
    }))
    .exhaustive();
}

function scopeOf(row: {
  scope: string;
  agentId: string | null;
  connectionId: string | null;
}): LimitScope | null {
  if (row.scope === "owner") return { kind: "owner" };
  if (row.scope === "agent" && row.agentId) {
    return { kind: "agent", agentId: row.agentId };
  }
  if (row.scope === "connection" && row.agentId && row.connectionId) {
    return {
      kind: "connection",
      agentId: row.agentId,
      connectionId: row.connectionId,
    };
  }
  return null;
}

export function createSpendLimits(db: Db): SpendLimits {
  return {
    async applying({ agentId, ownerSub }, day) {
      const rows = await db
        .select({
          id: spendLimits.id,
          ownerSub: spendLimits.ownerSub,
          scope: spendLimits.scope,
          agentId: spendLimits.agentId,
          connectionId: spendLimits.connectionId,
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
          and(
            eq(spendLimits.ownerSub, ownerSub),
            agentId === null
              ? eq(spendLimits.scope, "owner")
              : or(
                  eq(spendLimits.scope, "owner"),
                  eq(spendLimits.agentId, agentId),
                ),
          ),
        );
      return rows.flatMap((row) => {
        const scope = scopeOf(row);
        return scope
          ? [
              {
                id: row.id,
                ownerSub: row.ownerSub,
                scope,
                unit: row.unit as SpendUnit,
                amountMicros: row.amountMicros,
                extensions: Number(row.extensions),
              },
            ]
          : [];
      });
    },

    async set({ ownerSub, scope, unit, amountMicros }) {
      const [row] = await db
        .insert(spendLimits)
        .values({
          id: randomUUID(),
          ownerSub,
          scope: scope.kind,
          ...scopeColumns(scope),
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
        })
        .returning({ id: spendLimits.id });
      return row!.id;
    },

    async clear(ownerSub, scope) {
      const { agentId, connectionId } = scopeColumns(scope);
      const [row] = await db
        .delete(spendLimits)
        .where(
          and(
            eq(spendLimits.ownerSub, ownerSub),
            eq(spendLimits.scope, scope.kind),
            agentId === null
              ? isNull(spendLimits.agentId)
              : eq(spendLimits.agentId, agentId),
            connectionId === null
              ? isNull(spendLimits.connectionId)
              : eq(spendLimits.connectionId, connectionId),
          ),
        )
        .returning({ id: spendLimits.id });
      return row?.id ?? null;
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
