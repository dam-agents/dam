import {
  and,
  eq,
  isNotNull,
  like,
  lt,
  inArray,
  sql,
  type Db,
  invocations as invocationsTable,
} from "db";

export type InvocationStatus = "running" | "done" | "failed";

export interface InvocationRow {
  id: string;
  driverAgentId: string;
  owner: string;
  resultSchema: unknown;
  result: unknown;
  status: InvocationStatus;
  errorReason: string | null;
  expiresAt: Date;
  completedAt: Date | null;
  experimentSpanId: string | null;
}

export interface InvocationsRepository {
  insert(input: {
    id: string;
    driverAgentId: string;
    owner: string;
    resultSchema: unknown;
    expiresAt: Date;
    experimentSpanId: string | null;
  }): Promise<void>;
  get(id: string): Promise<InvocationRow | null>;
  complete(id: string, result: unknown): Promise<boolean>;
  fail(id: string, reason: string): Promise<void>;
  listExpiredRunning(now: Date, limit: number): Promise<InvocationRow[]>;
  listRunning(limit: number): Promise<InvocationRow[]>;
  listRunningByDriver(driverAgentId: string): Promise<InvocationRow[]>;
  listRunningAgentIds(olderThan: Date): Promise<string[]>;
  listAgedTerminal(before: Date, limit: number): Promise<InvocationRow[]>;
  listByExperiment(
    driverAgentId: string,
    experimentId: string,
    limit: number,
  ): Promise<InvocationRow[]>;
  countRunningByDriver(owner: string): Promise<Map<string, number>>;
  listTargetsByOwner(
    owner: string,
  ): Promise<{ driverAgentId: string; targetAgentId: string }[]>;
  failAllRunningByExperiment(
    driverAgentId: string,
    experimentId: string,
    reason: string,
  ): Promise<string[]>;
  delete(id: string): Promise<void>;
}

function toRow(r: typeof invocationsTable.$inferSelect): InvocationRow {
  return {
    id: r.id,
    driverAgentId: r.driverAgentId,
    owner: r.owner,
    resultSchema: r.resultSchema,
    result: r.result,
    status: r.status as InvocationStatus,
    errorReason: r.errorReason,
    expiresAt: r.expiresAt,
    completedAt: r.completedAt,
    experimentSpanId: r.experimentSpanId,
  };
}

export function createInvocationsRepository(db: Db): InvocationsRepository {
  return {
    async insert(input) {
      await db.insert(invocationsTable).values({
        id: input.id,
        driverAgentId: input.driverAgentId,
        owner: input.owner,
        resultSchema: input.resultSchema,
        status: "running",
        expiresAt: input.expiresAt,
        experimentSpanId: input.experimentSpanId,
      });
    },

    async get(id) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(eq(invocationsTable.id, id))
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async complete(id, result) {
      const updated = await db
        .update(invocationsTable)
        .set({ result, status: "done", completedAt: new Date() })
        .where(
          and(
            eq(invocationsTable.id, id),
            eq(invocationsTable.status, "running"),
          ),
        )
        .returning({ id: invocationsTable.id });
      return updated.length > 0;
    },

    async fail(id, reason) {
      await db
        .update(invocationsTable)
        .set({ status: "failed", errorReason: reason, completedAt: new Date() })
        .where(
          and(
            eq(invocationsTable.id, id),
            eq(invocationsTable.status, "running"),
          ),
        );
    },

    async listExpiredRunning(now, limit) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.status, "running"),
            lt(invocationsTable.expiresAt, now),
          ),
        )
        .limit(limit);
      return rows.map(toRow);
    },

    async listRunning(limit) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(eq(invocationsTable.status, "running"))
        .limit(limit);
      return rows.map(toRow);
    },

    async listRunningByDriver(driverAgentId) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.status, "running"),
            eq(invocationsTable.driverAgentId, driverAgentId),
          ),
        );
      return rows.map(toRow);
    },

    async listRunningAgentIds(olderThan) {
      const rows = await db
        .select({
          id: invocationsTable.id,
          driverAgentId: invocationsTable.driverAgentId,
        })
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.status, "running"),
            lt(invocationsTable.createdAt, olderThan),
          ),
        );
      const ids = new Set<string>();
      for (const r of rows) {
        ids.add(r.id);
        ids.add(r.driverAgentId);
      }
      return Array.from(ids);
    },

    async listAgedTerminal(before, limit) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(
          and(
            inArray(invocationsTable.status, ["done", "failed"]),
            lt(invocationsTable.completedAt, before),
          ),
        )
        .limit(limit);
      return rows.map(toRow);
    },

    async listByExperiment(driverAgentId, experimentId, limit) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.driverAgentId, driverAgentId),
            like(invocationsTable.experimentSpanId, `${experimentId}/%`),
          ),
        )
        .limit(limit);
      return rows.map(toRow);
    },

    async failAllRunningByExperiment(driverAgentId, experimentId, reason) {
      const updated = await db
        .update(invocationsTable)
        .set({ status: "failed", errorReason: reason, completedAt: new Date() })
        .where(
          and(
            eq(invocationsTable.driverAgentId, driverAgentId),
            like(invocationsTable.experimentSpanId, `${experimentId}/%`),
            eq(invocationsTable.status, "running"),
          ),
        )
        .returning({ id: invocationsTable.id });
      return updated.map((r) => r.id);
    },

    async listTargetsByOwner(owner) {
      const rows = await db
        .select({
          driverAgentId: invocationsTable.driverAgentId,
          targetAgentId: invocationsTable.id,
        })
        .from(invocationsTable)
        .where(eq(invocationsTable.owner, owner));
      return rows;
    },

    async countRunningByDriver(owner) {
      const rows = await db
        .select({
          driverAgentId: invocationsTable.driverAgentId,
          count: sql<number>`count(*)::int`,
        })
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.owner, owner),
            eq(invocationsTable.status, "running"),
            isNotNull(invocationsTable.experimentSpanId),
          ),
        )
        .groupBy(invocationsTable.driverAgentId);
      return new Map(rows.map((r) => [r.driverAgentId, r.count]));
    },

    async delete(id) {
      await db.delete(invocationsTable).where(eq(invocationsTable.id, id));
    },
  };
}
