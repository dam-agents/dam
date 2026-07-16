import { and, eq, lt, inArray, type Db, sandboxes as sandboxesTable } from "db";

/** Lifecycle of a sandbox node. `running` until the agent reports (or the
 *  liveness deadline fails it); terminal at `done`/`failed`. */
export type SandboxStatus = "running" | "done" | "failed";

export interface SandboxRow {
  id: string;
  driverAgentId: string;
  owner: string;
  resultSchema: unknown;
  result: unknown;
  status: SandboxStatus;
  errorReason: string | null;
  expiresAt: Date;
  completedAt: Date | null;
}

export interface SandboxesRepository {
  insert(input: {
    id: string;
    driverAgentId: string;
    owner: string;
    resultSchema: unknown;
    expiresAt: Date;
  }): Promise<void>;
  get(id: string): Promise<SandboxRow | null>;
  /** Store the validated result and flip to `done`. No-op (returns false) if the
   *  sandbox is no longer `running` — a late report after a liveness fail. */
  complete(id: string, result: unknown): Promise<boolean>;
  fail(id: string, reason: string): Promise<void>;
  /** `running` rows whose deadline has passed — the liveness sweep fails these. */
  listExpiredRunning(now: Date, limit: number): Promise<SandboxRow[]>;
  /** Terminal rows whose sandbox Agent is still to be reaped by the sweep. */
  listTerminal(limit: number): Promise<SandboxRow[]>;
  delete(id: string): Promise<void>;
}

function toRow(r: typeof sandboxesTable.$inferSelect): SandboxRow {
  return {
    id: r.id,
    driverAgentId: r.driverAgentId,
    owner: r.owner,
    resultSchema: r.resultSchema,
    result: r.result,
    status: r.status as SandboxStatus,
    errorReason: r.errorReason,
    expiresAt: r.expiresAt,
    completedAt: r.completedAt,
  };
}

export function createSandboxesRepository(db: Db): SandboxesRepository {
  return {
    async insert(input) {
      await db.insert(sandboxesTable).values({
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
        .from(sandboxesTable)
        .where(eq(sandboxesTable.id, id))
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async complete(id, result) {
      const updated = await db
        .update(sandboxesTable)
        .set({ result, status: "done", completedAt: new Date() })
        .where(
          and(eq(sandboxesTable.id, id), eq(sandboxesTable.status, "running")),
        )
        .returning({ id: sandboxesTable.id });
      return updated.length > 0;
    },

    async fail(id, reason) {
      await db
        .update(sandboxesTable)
        .set({ status: "failed", errorReason: reason, completedAt: new Date() })
        .where(
          and(eq(sandboxesTable.id, id), eq(sandboxesTable.status, "running")),
        );
    },

    async listExpiredRunning(now, limit) {
      const rows = await db
        .select()
        .from(sandboxesTable)
        .where(
          and(
            eq(sandboxesTable.status, "running"),
            lt(sandboxesTable.expiresAt, now),
          ),
        )
        .limit(limit);
      return rows.map(toRow);
    },

    async listTerminal(limit) {
      const rows = await db
        .select()
        .from(sandboxesTable)
        .where(inArray(sandboxesTable.status, ["done", "failed"]))
        .limit(limit);
      return rows.map(toRow);
    },

    async delete(id) {
      await db.delete(sandboxesTable).where(eq(sandboxesTable.id, id));
    },
  };
}
