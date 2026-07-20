import {
  and,
  eq,
  lt,
  inArray,
  type Db,
  invocations as invocationsTable,
} from "db";

/** Lifecycle of an Invocation. `running` until the target reports (or the
 *  liveness deadline fails it); terminal at `done`/`failed`. */
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
}

export interface InvocationsRepository {
  insert(input: {
    id: string;
    driverAgentId: string;
    owner: string;
    resultSchema: unknown;
    expiresAt: Date;
  }): Promise<void>;
  get(id: string): Promise<InvocationRow | null>;
  /** Store the validated result and flip to `done`. No-op (returns false) if the
   *  Invocation is no longer `running` — a late report after a liveness fail. */
  complete(id: string, result: unknown): Promise<boolean>;
  fail(id: string, reason: string): Promise<void>;
  /** `running` rows whose deadline has passed — the liveness sweep fails these. */
  listExpiredRunning(now: Date, limit: number): Promise<InvocationRow[]>;
  /** All `running` rows — the restart sweep checks each one's pod for a crash. */
  listRunning(limit: number): Promise<InvocationRow[]>;
  /** Terminal rows whose result is old enough to drop (retention elapsed). */
  listAgedTerminal(before: Date, limit: number): Promise<InvocationRow[]>;
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

    async delete(id) {
      await db.delete(invocationsTable).where(eq(invocationsTable.id, id));
    },
  };
}
