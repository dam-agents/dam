import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  spendDaily,
  type Db,
} from "db";
import type {
  SpendConnectionTotal,
  SpendDailyRow,
  SpendUnit,
} from "api-server-api";
import { match } from "ts-pattern";
import type { CallAmounts, DayCounter, SpendRow } from "../domain/ledger.js";

export interface SpendLedger {
  add(row: SpendRow, delta: CallAmounts, callCostMicros: number): Promise<void>;
  addRefusal(row: SpendRow): Promise<void>;
  total(counter: DayCounter): Promise<number>;
  highestCall(query: {
    payer: string;
    connectionId: string;
    from: string;
    to: string;
  }): Promise<number | null>;
  daily(query: {
    ownerSub: string;
    agentIds: readonly string[] | null;
    from: string;
    to: string;
  }): Promise<SpendDailyRow[]>;
  byConnection(query: {
    ownerSub: string;
    agentId: string;
    day: string;
  }): Promise<SpendConnectionTotal[]>;
}

type Counted =
  | "costMicros"
  | "uncachedInputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheWrite5mTokens"
  | "cacheWrite1hTokens"
  | "webSearches"
  | "calls"
  | "estimatedCalls"
  | "refusedCalls";

export function createSpendLedger(db: Db): SpendLedger {
  const added = (key: Counted) =>
    sql`${spendDaily[key]} + excluded.${sql.identifier(spendDaily[key].name)}`;
  const sumOf = (key: Counted) =>
    sql<string>`coalesce(sum(${spendDaily[key]}), 0)`;

  return {
    async add(row, delta, callCostMicros) {
      await db
        .insert(spendDaily)
        .values({
          day: row.day,
          payerAgentId: row.payer,
          connectionId: row.connectionId,
          model: row.model,
          ownerSub: row.ownerSub,
          providerTemplate: row.provider,
          unit: row.unit,
          costMicros: delta.costMicros,
          uncachedInputTokens: delta.uncachedInputTokens,
          outputTokens: delta.outputTokens,
          cacheReadTokens: delta.cacheReadTokens,
          cacheWrite5mTokens: delta.cacheWrite5mTokens,
          cacheWrite1hTokens: delta.cacheWrite1hTokens,
          webSearches: delta.webSearches,
          calls: delta.calls,
          estimatedCalls: delta.estimatedCalls,
          maxCallCostMicros: callCostMicros,
        })
        .onConflictDoUpdate({
          target: [
            spendDaily.day,
            spendDaily.payerAgentId,
            spendDaily.connectionId,
            spendDaily.model,
          ],
          set: {
            costMicros: added("costMicros"),
            uncachedInputTokens: added("uncachedInputTokens"),
            outputTokens: added("outputTokens"),
            cacheReadTokens: added("cacheReadTokens"),
            cacheWrite5mTokens: added("cacheWrite5mTokens"),
            cacheWrite1hTokens: added("cacheWrite1hTokens"),
            webSearches: added("webSearches"),
            calls: added("calls"),
            estimatedCalls: added("estimatedCalls"),
            maxCallCostMicros: sql`greatest(${spendDaily.maxCallCostMicros}, excluded.max_call_cost_micros)`,
            updatedAt: sql`now()`,
          },
        });
    },

    async addRefusal(row) {
      await db
        .insert(spendDaily)
        .values({
          day: row.day,
          payerAgentId: row.payer,
          connectionId: row.connectionId,
          model: row.model,
          ownerSub: row.ownerSub,
          providerTemplate: row.provider,
          unit: row.unit,
          refusedCalls: 1,
        })
        .onConflictDoUpdate({
          target: [
            spendDaily.day,
            spendDaily.payerAgentId,
            spendDaily.connectionId,
            spendDaily.model,
          ],
          set: {
            refusedCalls: added("refusedCalls"),
            updatedAt: sql`now()`,
          },
        });
    },

    async total(counter) {
      const where = match(counter)
        .with({ scope: "agent" }, (c) =>
          and(
            eq(spendDaily.day, c.day),
            eq(spendDaily.payerAgentId, c.agentId),
            eq(spendDaily.unit, c.unit),
          ),
        )
        .with({ scope: "owner" }, (c) =>
          and(
            eq(spendDaily.day, c.day),
            eq(spendDaily.ownerSub, c.ownerSub),
            eq(spendDaily.unit, c.unit),
          ),
        )
        .with({ scope: "connection" }, (c) =>
          and(
            eq(spendDaily.day, c.day),
            eq(spendDaily.payerAgentId, c.agentId),
            eq(spendDaily.connectionId, c.connectionId),
          ),
        )
        .exhaustive();
      const [row] = await db
        .select({ total: sumOf("costMicros") })
        .from(spendDaily)
        .where(where);
      return Number(row?.total ?? 0);
    },

    async highestCall({ payer, connectionId, from, to }) {
      const [row] = await db
        .select({
          highest: sql<string | null>`max(${spendDaily.maxCallCostMicros})`,
        })
        .from(spendDaily)
        .where(
          and(
            eq(spendDaily.payerAgentId, payer),
            eq(spendDaily.connectionId, connectionId),
            gte(spendDaily.day, from),
            lte(spendDaily.day, to),
          ),
        );
      return row?.highest == null ? null : Number(row.highest);
    },

    async daily({ ownerSub, agentIds, from, to }) {
      const rows = await db
        .select({
          day: spendDaily.day,
          agentId: spendDaily.payerAgentId,
          unit: spendDaily.unit,
          costMicros: sumOf("costMicros"),
          calls: sumOf("calls"),
          estimatedCalls: sumOf("estimatedCalls"),
          refusedCalls: sumOf("refusedCalls"),
          uncachedInputTokens: sumOf("uncachedInputTokens"),
          outputTokens: sumOf("outputTokens"),
          cacheReadTokens: sumOf("cacheReadTokens"),
          cacheWrite5mTokens: sumOf("cacheWrite5mTokens"),
          cacheWrite1hTokens: sumOf("cacheWrite1hTokens"),
          webSearches: sumOf("webSearches"),
        })
        .from(spendDaily)
        .where(
          and(
            eq(spendDaily.ownerSub, ownerSub),
            gte(spendDaily.day, from),
            lte(spendDaily.day, to),
            agentIds
              ? inArray(spendDaily.payerAgentId, [...agentIds])
              : undefined,
          ),
        )
        .groupBy(spendDaily.day, spendDaily.payerAgentId, spendDaily.unit)
        .orderBy(
          desc(spendDaily.day),
          asc(spendDaily.payerAgentId),
          asc(spendDaily.unit),
        );
      return rows.map((r) => ({
        day: r.day,
        agentId: r.agentId,
        unit: r.unit as SpendUnit,
        costMicros: Number(r.costMicros),
        calls: Number(r.calls),
        estimatedCalls: Number(r.estimatedCalls),
        refusedCalls: Number(r.refusedCalls),
        uncachedInputTokens: Number(r.uncachedInputTokens),
        outputTokens: Number(r.outputTokens),
        cacheReadTokens: Number(r.cacheReadTokens),
        cacheWrite5mTokens: Number(r.cacheWrite5mTokens),
        cacheWrite1hTokens: Number(r.cacheWrite1hTokens),
        webSearches: Number(r.webSearches),
      }));
    },

    async byConnection({ ownerSub, agentId, day }) {
      const rows = await db
        .select({
          connectionId: spendDaily.connectionId,
          unit: spendDaily.unit,
          costMicros: sumOf("costMicros"),
          estimatedCalls: sumOf("estimatedCalls"),
        })
        .from(spendDaily)
        .where(
          and(
            eq(spendDaily.ownerSub, ownerSub),
            eq(spendDaily.payerAgentId, agentId),
            eq(spendDaily.day, day),
          ),
        )
        .groupBy(spendDaily.connectionId, spendDaily.unit)
        .orderBy(asc(spendDaily.connectionId), asc(spendDaily.unit));
      return rows.map((r) => ({
        connectionId: r.connectionId,
        unit: r.unit as SpendUnit,
        costMicros: Number(r.costMicros),
        estimatedCalls: Number(r.estimatedCalls),
      }));
    },
  };
}
