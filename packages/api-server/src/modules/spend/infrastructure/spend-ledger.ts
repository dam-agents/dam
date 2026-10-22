import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  ne,
  sql,
  spendCalls,
  spendDaily,
  spendMetering,
  type Db,
} from "db";
import type {
  SpendCallCost,
  SpendConnectionTotal,
  SpendDailyRow,
  SpendUnit,
} from "api-server-api";
import { match } from "ts-pattern";
import type { BreakdownRow } from "../domain/breakdown.js";
import type {
  CallAmounts,
  CallWindow,
  DayCounter,
  SpendRow,
} from "../domain/ledger.js";
import type { AgentLedgerRow } from "../domain/agent-spend.js";
import type { SessionLedgerRow } from "../domain/sessions.js";
import type { SettledCall, TurnWindowRow } from "../domain/turns.js";

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
    agentId: string | null;
    day: string;
  }): Promise<SpendConnectionTotal[]>;
  breakdownRows(query: {
    ownerSub: string;
    agentIds: readonly string[] | null;
    callingAgentId?: string;
    from: string;
    to: string;
    at?: CallWindow;
  }): Promise<BreakdownRow[]>;
  sessionRows(query: {
    ownerSub: string;
    callingAgentIds: readonly string[];
    sessionIds?: readonly string[];
    withSessionOnly: boolean;
    from: string;
    to: string;
    at?: CallWindow;
  }): Promise<SessionLedgerRow[]>;
  agentRows(query: {
    ownerSub: string;
    payer?: string;
    callingAgentIds?: readonly string[];
    sessionId?: string;
    from: string;
    to: string;
    at?: CallWindow;
  }): Promise<AgentLedgerRow[]>;
  putCall(call: SettledCall): Promise<void>;
  turnWindows(query: {
    ownerSub: string;
    callingAgentId: string;
    sessionId?: string;
    windows: readonly { from: string; to: string }[];
  }): Promise<TurnWindowRow[]>;
  callCosts(query: {
    ownerSub: string;
    routerCallIds: readonly string[];
  }): Promise<SpendCallCost[]>;
  deleteCallsBefore(before: Date): Promise<number>;
  meteringStart(): Promise<Date>;
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
  | "refusedCalls"
  | "durationMs";

const ROW_KEY = [
  spendDaily.day,
  spendDaily.payerAgentId,
  spendDaily.connectionId,
  spendDaily.model,
  spendDaily.sessionId,
  spendDaily.callingAgentId,
];

export function createSpendLedger(db: Db): SpendLedger {
  const added = (key: Counted) =>
    sql`${spendDaily[key]} + excluded.${sql.identifier(spendDaily[key].name)}`;
  const sumOf = (key: Counted) =>
    sql<string>`coalesce(sum(${spendDaily[key]}), 0)`;
  const hasCalls = sql`sum(${spendDaily.calls}) > 0`;

  const callsAsDays = (at: CallWindow) =>
    db
      .select({
        day: sql<string>`(${spendCalls.startedAt} at time zone 'UTC')::date::text`.as(
          "day",
        ),
        ownerSub: spendCalls.ownerSub,
        payerAgentId: spendCalls.payerAgentId,
        connectionId: spendCalls.connectionId,
        providerTemplate: spendCalls.providerTemplate,
        model: spendCalls.model,
        sessionId: spendCalls.sessionId,
        callingAgentId: spendCalls.callingAgentId,
        unit: spendCalls.unit,
        costMicros: spendCalls.costMicros,
        calls: sql<number>`1`.as("calls"),
        estimatedCalls: sql<number>`(${spendCalls.estimated})::int`.as(
          "estimated_calls",
        ),
        uncachedInputTokens: spendCalls.uncachedInputTokens,
        outputTokens: spendCalls.outputTokens,
        cacheReadTokens: spendCalls.cacheReadTokens,
        cacheWrite5mTokens: spendCalls.cacheWrite5mTokens,
        cacheWrite1hTokens: spendCalls.cacheWrite1hTokens,
        webSearches: spendCalls.webSearches,
        durationMs: spendCalls.durationMs,
      })
      .from(spendCalls)
      .where(
        and(
          gte(spendCalls.startedAt, at.fromAt),
          lt(spendCalls.startedAt, at.toAt),
        ),
      )
      .as("call_rows");

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a read over whole UTC days sums the daily
   * rollup; a read with an exact window sums the call rows inside it, shaped
   * as rollup rows, so every grouped read serves both.
   */
  const sourceOf = (range: { from: string; to: string; at?: CallWindow }) => {
    if (range.at) {
      return { t: callsAsDays(range.at), inRange: undefined };
    }
    return {
      t: spendDaily,
      inRange: and(
        gte(spendDaily.day, range.from),
        lte(spendDaily.day, range.to),
      ),
    };
  };
  type Source = ReturnType<typeof sourceOf>["t"];

  const sessionTimes = async (
    ownerSub: string,
    callingAgentIds: readonly string[],
    sessionIds: readonly string[],
    at: CallWindow,
  ) => {
    if (callingAgentIds.length === 0 || sessionIds.length === 0)
      return new Map<string, { firstAt: string; lastAt: string }>();
    const rows = await db
      .select({
        callingAgentId: spendCalls.callingAgentId,
        sessionId: spendCalls.sessionId,
        firstAt: sql<Date>`min(${spendCalls.startedAt})`,
        lastAt: sql<Date>`max(${spendCalls.startedAt})`,
      })
      .from(spendCalls)
      .where(
        and(
          eq(spendCalls.ownerSub, ownerSub),
          inArray(spendCalls.callingAgentId, [...callingAgentIds]),
          inArray(spendCalls.sessionId, [...sessionIds]),
          gte(spendCalls.startedAt, at.fromAt),
          lt(spendCalls.startedAt, at.toAt),
        ),
      )
      .groupBy(spendCalls.callingAgentId, spendCalls.sessionId);
    return new Map(
      rows.map((r) => [
        `${r.callingAgentId}\u0000${r.sessionId}`,
        {
          firstAt: new Date(r.firstAt).toISOString(),
          lastAt: new Date(r.lastAt).toISOString(),
        },
      ]),
    );
  };
  type Summed = Exclude<Counted, "refusedCalls">;
  const sumIn = (t: Source, key: Summed) =>
    sql<string>`coalesce(sum(${t[key]}), 0)`;
  const hasCallsIn = (t: Source) => sql`sum(${t.calls}) > 0`;

  return {
    async add(row, delta, callCostMicros) {
      await db
        .insert(spendDaily)
        .values({
          day: row.day,
          payerAgentId: row.payer,
          connectionId: row.connectionId,
          model: row.model,
          sessionId: row.sessionId,
          callingAgentId: row.callingAgentId,
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
          durationMs: delta.durationMs,
          maxCallCostMicros: callCostMicros,
        })
        .onConflictDoUpdate({
          target: ROW_KEY,
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
            durationMs: added("durationMs"),
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
          sessionId: row.sessionId,
          callingAgentId: row.callingAgentId,
          ownerSub: row.ownerSub,
          providerTemplate: row.provider,
          unit: row.unit,
          refusedCalls: 1,
        })
        .onConflictDoUpdate({
          target: ROW_KEY,
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
        .with({ scope: "owner-connection" }, (c) =>
          and(
            eq(spendDaily.day, c.day),
            eq(spendDaily.ownerSub, c.ownerSub),
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
            agentId === null ? undefined : eq(spendDaily.payerAgentId, agentId),
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

    async breakdownRows({ ownerSub, agentIds, callingAgentId, from, to, at }) {
      const { t, inRange } = sourceOf({ from, to, ...(at && { at }) });
      const rows = await db
        .select({
          day: t.day,
          payer: t.payerAgentId,
          connectionId: t.connectionId,
          providerTemplate: t.providerTemplate,
          model: t.model,
          sessionId: t.sessionId,
          callingAgentId: t.callingAgentId,
          unit: t.unit,
          costMicros: sumIn(t, "costMicros"),
          calls: sumIn(t, "calls"),
          estimatedCalls: sumIn(t, "estimatedCalls"),
          uncachedInputTokens: sumIn(t, "uncachedInputTokens"),
          outputTokens: sumIn(t, "outputTokens"),
          cacheReadTokens: sumIn(t, "cacheReadTokens"),
          cacheWrite5mTokens: sumIn(t, "cacheWrite5mTokens"),
          cacheWrite1hTokens: sumIn(t, "cacheWrite1hTokens"),
          webSearches: sumIn(t, "webSearches"),
          durationMs: sumIn(t, "durationMs"),
        })
        .from(t)
        .where(
          and(
            eq(t.ownerSub, ownerSub),
            inRange,
            agentIds ? inArray(t.payerAgentId, [...agentIds]) : undefined,
            callingAgentId !== undefined
              ? eq(t.callingAgentId, callingAgentId)
              : undefined,
          ),
        )
        .groupBy(
          t.day,
          t.payerAgentId,
          t.connectionId,
          t.providerTemplate,
          t.model,
          t.sessionId,
          t.callingAgentId,
          t.unit,
        )
        .having(hasCallsIn(t));
      return rows.map((r) => ({
        day: r.day,
        payer: r.payer,
        connectionId: r.connectionId,
        providerTemplate: r.providerTemplate,
        model: r.model,
        sessionId: r.sessionId,
        callingAgentId: r.callingAgentId,
        unit: r.unit as SpendUnit,
        costMicros: Number(r.costMicros),
        calls: Number(r.calls),
        estimatedCalls: Number(r.estimatedCalls),
        uncachedInputTokens: Number(r.uncachedInputTokens),
        outputTokens: Number(r.outputTokens),
        cacheReadTokens: Number(r.cacheReadTokens),
        cacheWrite5mTokens: Number(r.cacheWrite5mTokens),
        cacheWrite1hTokens: Number(r.cacheWrite1hTokens),
        webSearches: Number(r.webSearches),
        durationMs: Number(r.durationMs),
      }));
    },

    async sessionRows({
      ownerSub,
      callingAgentIds,
      sessionIds,
      withSessionOnly,
      from,
      to,
      at,
    }) {
      if (callingAgentIds.length === 0) return [];
      const { t, inRange } = sourceOf({ from, to, ...(at && { at }) });
      const rows = await db
        .select({
          callingAgentId: t.callingAgentId,
          sessionId: t.sessionId,
          unit: t.unit,
          costMicros: sumIn(t, "costMicros"),
          calls: sumIn(t, "calls"),
          durationMs: sumIn(t, "durationMs"),
          uncachedInputTokens: sumIn(t, "uncachedInputTokens"),
          outputTokens: sumIn(t, "outputTokens"),
          cacheReadTokens: sumIn(t, "cacheReadTokens"),
          cacheWrite5mTokens: sumIn(t, "cacheWrite5mTokens"),
          cacheWrite1hTokens: sumIn(t, "cacheWrite1hTokens"),
          firstDay: sql<string>`min(${t.day})::text`,
          lastDay: sql<string>`max(${t.day})::text`,
        })
        .from(t)
        .where(
          and(
            eq(t.ownerSub, ownerSub),
            inArray(t.callingAgentId, [...callingAgentIds]),
            inRange,
            withSessionOnly ? ne(t.sessionId, "") : undefined,
            sessionIds ? inArray(t.sessionId, [...sessionIds]) : undefined,
          ),
        )
        .groupBy(t.callingAgentId, t.sessionId, t.unit)
        .having(hasCallsIn(t));
      const times = await sessionTimes(
        ownerSub,
        callingAgentIds,
        [...new Set(rows.map((r) => r.sessionId))],
        at ?? {
          fromAt: new Date(`${from}T00:00:00Z`),
          toAt: new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000),
        },
      );
      return rows.map((r) => {
        const time = times.get(`${r.callingAgentId}\u0000${r.sessionId}`);
        return {
          callingAgentId: r.callingAgentId,
          sessionId: r.sessionId,
          unit: r.unit as SpendUnit,
          costMicros: Number(r.costMicros),
          calls: Number(r.calls),
          durationMs: Number(r.durationMs),
          uncachedInputTokens: Number(r.uncachedInputTokens),
          outputTokens: Number(r.outputTokens),
          cacheReadTokens: Number(r.cacheReadTokens),
          cacheWrite5mTokens: Number(r.cacheWrite5mTokens),
          cacheWrite1hTokens: Number(r.cacheWrite1hTokens),
          firstDay: r.firstDay,
          lastDay: r.lastDay,
          ...time,
        };
      });
    },

    async agentRows({
      ownerSub,
      payer,
      callingAgentIds,
      sessionId,
      from,
      to,
      at,
    }) {
      if (callingAgentIds?.length === 0) return [];
      const { t, inRange } = sourceOf({ from, to, ...(at && { at }) });
      const rows = await db
        .select({
          callingAgentId: t.callingAgentId,
          sessionId: t.sessionId,
          model: t.model,
          unit: t.unit,
          costMicros: sumIn(t, "costMicros"),
          calls: sumIn(t, "calls"),
          estimatedCalls: sumIn(t, "estimatedCalls"),
          uncachedInputTokens: sumIn(t, "uncachedInputTokens"),
          outputTokens: sumIn(t, "outputTokens"),
          cacheReadTokens: sumIn(t, "cacheReadTokens"),
          cacheWrite5mTokens: sumIn(t, "cacheWrite5mTokens"),
          cacheWrite1hTokens: sumIn(t, "cacheWrite1hTokens"),
          webSearches: sumIn(t, "webSearches"),
          durationMs: sumIn(t, "durationMs"),
          firstDay: sql<string>`min(${t.day})::text`,
          lastDay: sql<string>`max(${t.day})::text`,
        })
        .from(t)
        .where(
          and(
            eq(t.ownerSub, ownerSub),
            inRange,
            payer !== undefined ? eq(t.payerAgentId, payer) : undefined,
            callingAgentIds
              ? inArray(t.callingAgentId, [...callingAgentIds])
              : undefined,
            sessionId !== undefined ? eq(t.sessionId, sessionId) : undefined,
          ),
        )
        .groupBy(t.callingAgentId, t.sessionId, t.model, t.unit)
        .having(hasCallsIn(t));
      return rows.map((r) => ({
        callingAgentId: r.callingAgentId,
        sessionId: r.sessionId,
        model: r.model,
        unit: r.unit as SpendUnit,
        costMicros: Number(r.costMicros),
        calls: Number(r.calls),
        estimatedCalls: Number(r.estimatedCalls),
        uncachedInputTokens: Number(r.uncachedInputTokens),
        outputTokens: Number(r.outputTokens),
        cacheReadTokens: Number(r.cacheReadTokens),
        cacheWrite5mTokens: Number(r.cacheWrite5mTokens),
        cacheWrite1hTokens: Number(r.cacheWrite1hTokens),
        webSearches: Number(r.webSearches),
        durationMs: Number(r.durationMs),
        firstDay: r.firstDay,
        lastDay: r.lastDay,
      }));
    },

    async putCall(call) {
      const row = {
        ownerSub: call.ownerSub,
        payerAgentId: call.payer,
        sessionId: call.sessionId,
        startedAt: call.startedAt,
        unit: call.unit,
        costMicros: call.costMicros,
        routerCallId: call.routerCallId,
        connectionId: call.connectionId,
        providerTemplate: call.providerTemplate,
        model: call.model,
        uncachedInputTokens: call.uncachedInputTokens,
        outputTokens: call.outputTokens,
        cacheReadTokens: call.cacheReadTokens,
        cacheWrite5mTokens: call.cacheWrite5mTokens,
        cacheWrite1hTokens: call.cacheWrite1hTokens,
        webSearches: call.webSearches,
        durationMs: call.durationMs,
        estimated: call.estimated,
      };
      await db
        .insert(spendCalls)
        .values({
          callingAgentId: call.callingAgentId,
          callId: call.callId,
          ...row,
        })
        .onConflictDoUpdate({
          target: [spendCalls.callingAgentId, spendCalls.callId],
          set: row,
        });
    },

    async turnWindows({ ownerSub, callingAgentId, sessionId, windows }) {
      if (windows.length === 0) return [];
      const values = sql.join(
        windows.map(
          (w, i) =>
            sql`(${i}::int, ${w.from}::timestamptz, ${w.to}::timestamptz)`,
        ),
        sql`, `,
      );
      const rows = await db.execute<{
        window: number;
        unit: string;
        cost_micros: string;
        calls: number;
      }>(sql`
        SELECT w.i AS window, c.unit, sum(c.cost_micros)::text AS cost_micros,
          count(*)::int AS calls
        FROM (VALUES ${values}) AS w(i, f, t)
        JOIN ${spendCalls} c
          ON c.calling_agent_id = ${callingAgentId}
          AND c.owner_sub = ${ownerSub}
          AND c.started_at BETWEEN w.f AND w.t
          ${sessionId !== undefined ? sql`AND c.session_id = ${sessionId}` : sql``}
        GROUP BY w.i, c.unit`);
      return rows.map((r) => ({
        window: Number(r.window),
        unit: r.unit as SpendUnit,
        costMicros: Number(r.cost_micros),
        calls: Number(r.calls),
      }));
    },

    async callCosts({ ownerSub, routerCallIds }) {
      if (routerCallIds.length === 0) return [];
      const rows = await db
        .select({
          routerCallId: spendCalls.routerCallId,
          unit: spendCalls.unit,
          costMicros: spendCalls.costMicros,
          estimated: spendCalls.estimated,
        })
        .from(spendCalls)
        .where(
          and(
            eq(spendCalls.ownerSub, ownerSub),
            inArray(spendCalls.routerCallId, [...routerCallIds]),
          ),
        );
      return rows.map((r) => ({ ...r, unit: r.unit as SpendUnit }));
    },

    async deleteCallsBefore(before) {
      const [row] = await db.execute<{ deleted: number }>(sql`
        WITH gone AS (
          DELETE FROM ${spendCalls}
          WHERE ${spendCalls.startedAt} < ${before.toISOString()}::timestamptz
          RETURNING 1
        )
        SELECT count(*)::int AS deleted FROM gone`);
      return Number(row?.deleted ?? 0);
    },

    async meteringStart() {
      const [row] = await db
        .select({ startedAt: spendMetering.startedAt })
        .from(spendMetering)
        .where(eq(spendMetering.id, 1));
      if (!row) {
        throw new Error(
          "spend_metering has no measuring start: the spend_metering_start migration did not run",
        );
      }
      return row.startedAt;
    },
  };
}
