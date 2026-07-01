import { randomBytes } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  sql,
  type Db,
  type DbTx,
  experiments as experimentsTable,
  experimentArms as experimentArmsTable,
  experimentRuns as experimentRunsTable,
} from "db";
import type {
  ArmStatus,
  Experiment,
  ExperimentArm,
  ExperimentListItem,
  ExperimentRun,
  ExperimentStatus,
} from "api-server-api";
import { allArmsTerminal } from "../domain/arm-status.js";

const RUNNING_STATUS: ExperimentStatus = "running";
const ARM_RUNNING: ArmStatus = "running";

export interface ExperimentsRepository {
  create(input: {
    ownerId: string;
    name: string;
    prompt: string;
  }): Promise<Experiment>;
  listByOwner(ownerId: string): Promise<ExperimentListItem[]>;
  get(id: string, ownerId: string): Promise<Experiment | null>;
  updateStatus(
    id: string,
    ownerId: string,
    status: ExperimentStatus,
  ): Promise<Experiment | null>;
  /** Atomically Stop a running experiment: flip it to `stopped` and move every
   *  still-`running` arm to `stopped` in one transaction. Returns the
   *  experiment as it stands after (null only if it doesn't exist for owner).
   *  A no-op on a non-running experiment. */
  stop(id: string, ownerId: string): Promise<Experiment | null>;
  delete(id: string, ownerId: string): Promise<void>;

  addArm(input: {
    experimentId: string;
    agentId: string;
    armVariation: string;
  }): Promise<ExperimentArm>;
  listArms(experimentId: string): Promise<ExperimentArm[]>;
  listRuns(experimentId: string): Promise<ExperimentRun[]>;
  /** Move every `pending`/`stopped` arm of an experiment to `running` and start
   *  its inactivity clock. Called by the start path once the experiment is
   *  running; terminal (`completed`/`failed`) arms are left as-is. */
  markArmsRunning(experimentId: string): Promise<void>;
  /** Mark one `running` arm `failed` immediately (a Trial that failed to launch
   *  — don't wait for the inactivity sweep) and flip the experiment to
   *  `completed` if that was the last non-terminal arm. No-op unless the arm is
   *  `running`. */
  failLaunch(experimentId: string, agentId: string): Promise<void>;

  /** Append a Run for a `running` arm, allocating the next per-arm run number
   *  and resetting the arm's inactivity clock — all under the arm row lock so
   *  concurrent records can't collide on run number. Returns null when the arm
   *  is no longer `running` (Stop / completion raced in): the ledger guard. */
  addRun(input: {
    experimentId: string;
    agentId: string;
    sessionId: string;
    candidateRef: string;
    score: number;
    status: string;
  }): Promise<ExperimentRun | null>;

  /** Mark a `running` arm `completed` and flip the experiment to `completed` if
   *  it was the last non-terminal arm — atomically, under a row lock on the
   *  experiment, so concurrent finishers / finish-vs-sweep can't double-flip.
   *  Returns null when the arm is no longer `running`: the finish guard. */
  finishArm(
    experimentId: string,
    agentId: string,
  ): Promise<ExperimentArm | null>;

  /** The arm of the owner's single running experiment that contains `agentId`
   *  AND is itself still `running`, or null. Owner-scoped so a leaked agentId
   *  can't reach another tenant; arm-status-scoped so a finished/stopped arm
   *  resolves to null (the cooperative-stop signal the harness skill reads). */
  findActiveArm(
    agentId: string,
    ownerId: string,
  ): Promise<{ experiment: Experiment; arm: ExperimentArm } | null>;

  /** Running arms whose inactivity clock is older than `deadline` — the sweep's
   *  candidate set. Owner-agnostic (the sweep is a system job). Oldest first,
   *  capped at `limit`. */
  listInactiveRunningArms(
    deadline: Date,
    limit: number,
  ): Promise<Array<{ experimentId: string; agentId: string }>>;
  /** Reap one inactive arm: re-check it is still `running` and still past
   *  `deadline` under the lock (a Run recorded since listing resets the clock
   *  and spares it), mark it `failed`, and flip the experiment to `completed`
   *  if it was the last non-terminal arm. Returns whether it was reaped. */
  failInactiveArm(
    experimentId: string,
    agentId: string,
    deadline: Date,
  ): Promise<boolean>;
}

type ExperimentRow = typeof experimentsTable.$inferSelect;
type ArmRow = typeof experimentArmsTable.$inferSelect;
type RunRow = typeof experimentRunsTable.$inferSelect;

function rowToExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    ownerId: row.owner,
    name: row.name,
    prompt: row.prompt,
    status: row.status as ExperimentStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToArm(row: ArmRow): ExperimentArm {
  return {
    experimentId: row.experimentId,
    agentId: row.agentId,
    armVariation: row.armVariation,
    status: row.status as ArmStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToRun(row: RunRow): ExperimentRun {
  return {
    id: row.id,
    experimentId: row.experimentId,
    agentId: row.agentId,
    runNumber: row.runNumber,
    sessionId: row.sessionId,
    candidateRef: row.candidateRef,
    score: row.score,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

export function createExperimentsRepository(db: Db): ExperimentsRepository {
  /** Flip an experiment to `completed` iff every one of its arms is now
   *  terminal. Conditional on the experiment still being `running` so a Stop
   *  that raced in is never overwritten back to `completed`. Caller holds the
   *  experiment row lock. */
  async function completeIfAllTerminal(
    tx: DbTx,
    experimentId: string,
  ): Promise<void> {
    const arms = await tx
      .select({ status: experimentArmsTable.status })
      .from(experimentArmsTable)
      .where(eq(experimentArmsTable.experimentId, experimentId));
    if (!allArmsTerminal(arms.map((a) => a.status as ArmStatus))) return;
    await tx
      .update(experimentsTable)
      .set({ status: "completed", updatedAt: new Date() })
      .where(
        and(
          eq(experimentsTable.id, experimentId),
          eq(experimentsTable.status, RUNNING_STATUS),
        ),
      );
  }

  /** Lock the experiment + one arm row (experiment first — the lock order every
   *  terminal-transition path shares, so finish / sweep / launch-fail / stop
   *  never deadlock), require both `running`, set the arm terminal, and flip the
   *  experiment if that was the last non-terminal arm. `extraArmGuard` lets the
   *  sweep re-check its deadline under the lock. Returns the updated arm row or
   *  null if any guard fails. */
  async function transitionRunningArm(
    experimentId: string,
    agentId: string,
    terminal: Extract<ArmStatus, "completed" | "failed">,
    extraArmGuard?: (arm: ArmRow) => boolean,
  ): Promise<ArmRow | null> {
    return db.transaction(async (tx) => {
      const expRows = await tx
        .select()
        .from(experimentsTable)
        .where(eq(experimentsTable.id, experimentId))
        .for("update");
      if (expRows[0]?.status !== RUNNING_STATUS) return null;

      const armRows = await tx
        .select()
        .from(experimentArmsTable)
        .where(
          and(
            eq(experimentArmsTable.experimentId, experimentId),
            eq(experimentArmsTable.agentId, agentId),
          ),
        )
        .for("update");
      const arm = armRows[0];
      if (!arm || arm.status !== ARM_RUNNING) return null;
      if (extraArmGuard && !extraArmGuard(arm)) return null;

      await tx
        .update(experimentArmsTable)
        .set({ status: terminal })
        .where(
          and(
            eq(experimentArmsTable.experimentId, experimentId),
            eq(experimentArmsTable.agentId, agentId),
          ),
        );
      await completeIfAllTerminal(tx, experimentId);
      return { ...arm, status: terminal };
    });
  }

  return {
    async create(input): Promise<Experiment> {
      const id = `exp-${randomBytes(6).toString("hex")}`;
      await db.insert(experimentsTable).values({
        id,
        owner: input.ownerId,
        name: input.name,
        prompt: input.prompt,
      });
      const created = await this.get(id, input.ownerId);
      if (!created) {
        throw new Error(`create: experiment ${id} not found after insert`);
      }
      return created;
    },

    async listByOwner(ownerId): Promise<ExperimentListItem[]> {
      const rows = await db
        .select()
        .from(experimentsTable)
        .where(eq(experimentsTable.owner, ownerId))
        .orderBy(desc(experimentsTable.createdAt));
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const [armRows, runCountRows] = await Promise.all([
        db
          .select({
            experimentId: experimentArmsTable.experimentId,
            agentId: experimentArmsTable.agentId,
          })
          .from(experimentArmsTable)
          .where(inArray(experimentArmsTable.experimentId, ids))
          .orderBy(asc(experimentArmsTable.createdAt)),
        db
          .select({
            experimentId: experimentRunsTable.experimentId,
            count: sql<number>`count(*)::int`,
          })
          .from(experimentRunsTable)
          .where(inArray(experimentRunsTable.experimentId, ids))
          .groupBy(experimentRunsTable.experimentId),
      ]);

      const armAgentIdsByExperiment = new Map<string, string[]>();
      for (const arm of armRows) {
        const list = armAgentIdsByExperiment.get(arm.experimentId);
        if (list) list.push(arm.agentId);
        else armAgentIdsByExperiment.set(arm.experimentId, [arm.agentId]);
      }
      const runCountByExperiment = new Map(
        runCountRows.map((r) => [r.experimentId, r.count]),
      );

      return rows.map((row) => ({
        ...rowToExperiment(row),
        armAgentIds: armAgentIdsByExperiment.get(row.id) ?? [],
        runCount: runCountByExperiment.get(row.id) ?? 0,
      }));
    },

    async get(id, ownerId): Promise<Experiment | null> {
      const rows = await db
        .select()
        .from(experimentsTable)
        .where(
          and(eq(experimentsTable.id, id), eq(experimentsTable.owner, ownerId)),
        );
      return rows[0] ? rowToExperiment(rows[0]) : null;
    },

    async updateStatus(id, ownerId, status): Promise<Experiment | null> {
      await db
        .update(experimentsTable)
        .set({ status, updatedAt: new Date() })
        .where(
          and(eq(experimentsTable.id, id), eq(experimentsTable.owner, ownerId)),
        );
      return this.get(id, ownerId);
    },

    async stop(id, ownerId): Promise<Experiment | null> {
      return db.transaction(async (tx) => {
        const expRows = await tx
          .select()
          .from(experimentsTable)
          .where(
            and(
              eq(experimentsTable.id, id),
              eq(experimentsTable.owner, ownerId),
            ),
          )
          .for("update");
        const exp = expRows[0];
        if (!exp) return null;
        if (exp.status === RUNNING_STATUS) {
          await tx
            .update(experimentsTable)
            .set({ status: "stopped", updatedAt: new Date() })
            .where(
              and(
                eq(experimentsTable.id, id),
                eq(experimentsTable.owner, ownerId),
              ),
            );
          await tx
            .update(experimentArmsTable)
            .set({ status: "stopped" })
            .where(
              and(
                eq(experimentArmsTable.experimentId, id),
                eq(experimentArmsTable.status, ARM_RUNNING),
              ),
            );
        }
        const after = await tx
          .select()
          .from(experimentsTable)
          .where(
            and(
              eq(experimentsTable.id, id),
              eq(experimentsTable.owner, ownerId),
            ),
          );
        return after[0] ? rowToExperiment(after[0]) : null;
      });
    },

    async delete(id, ownerId): Promise<void> {
      const existing = await this.get(id, ownerId);
      if (!existing) return;
      await db
        .delete(experimentRunsTable)
        .where(eq(experimentRunsTable.experimentId, id));
      await db
        .delete(experimentArmsTable)
        .where(eq(experimentArmsTable.experimentId, id));
      await db
        .delete(experimentsTable)
        .where(
          and(eq(experimentsTable.id, id), eq(experimentsTable.owner, ownerId)),
        );
    },

    async addArm(input): Promise<ExperimentArm> {
      await db.insert(experimentArmsTable).values({
        experimentId: input.experimentId,
        agentId: input.agentId,
        armVariation: input.armVariation,
      });
      const rows = await db
        .select()
        .from(experimentArmsTable)
        .where(
          and(
            eq(experimentArmsTable.experimentId, input.experimentId),
            eq(experimentArmsTable.agentId, input.agentId),
          ),
        );
      if (!rows[0]) {
        throw new Error(`addArm: arm not found after insert`);
      }
      return rowToArm(rows[0]);
    },

    async listArms(experimentId): Promise<ExperimentArm[]> {
      const rows = await db
        .select()
        .from(experimentArmsTable)
        .where(eq(experimentArmsTable.experimentId, experimentId))
        .orderBy(asc(experimentArmsTable.createdAt));
      return rows.map(rowToArm);
    },

    async listRuns(experimentId): Promise<ExperimentRun[]> {
      const rows = await db
        .select()
        .from(experimentRunsTable)
        .where(eq(experimentRunsTable.experimentId, experimentId))
        .orderBy(asc(experimentRunsTable.runNumber));
      return rows.map(rowToRun);
    },

    async markArmsRunning(experimentId): Promise<void> {
      await db
        .update(experimentArmsTable)
        .set({ status: "running", lastActivityAt: new Date() })
        .where(
          and(
            eq(experimentArmsTable.experimentId, experimentId),
            inArray(experimentArmsTable.status, ["pending", "stopped"]),
          ),
        );
    },

    async failLaunch(experimentId, agentId): Promise<void> {
      await transitionRunningArm(experimentId, agentId, "failed");
    },

    async addRun(input): Promise<ExperimentRun | null> {
      return db.transaction(async (tx) => {
        const armRows = await tx
          .select()
          .from(experimentArmsTable)
          .where(
            and(
              eq(experimentArmsTable.experimentId, input.experimentId),
              eq(experimentArmsTable.agentId, input.agentId),
            ),
          )
          .for("update");
        const arm = armRows[0];
        if (!arm || arm.status !== ARM_RUNNING) return null;

        const [last] = await tx
          .select({ runNumber: experimentRunsTable.runNumber })
          .from(experimentRunsTable)
          .where(
            and(
              eq(experimentRunsTable.experimentId, input.experimentId),
              eq(experimentRunsTable.agentId, input.agentId),
            ),
          )
          .orderBy(desc(experimentRunsTable.runNumber))
          .limit(1);
        const runNumber = (last?.runNumber ?? 0) + 1;
        const id = `run-${randomBytes(6).toString("hex")}`;
        await tx.insert(experimentRunsTable).values({
          id,
          experimentId: input.experimentId,
          agentId: input.agentId,
          runNumber,
          sessionId: input.sessionId,
          candidateRef: input.candidateRef,
          score: input.score,
          status: input.status,
        });
        await tx
          .update(experimentArmsTable)
          .set({ lastActivityAt: new Date() })
          .where(
            and(
              eq(experimentArmsTable.experimentId, input.experimentId),
              eq(experimentArmsTable.agentId, input.agentId),
            ),
          );
        const [row] = await tx
          .select()
          .from(experimentRunsTable)
          .where(eq(experimentRunsTable.id, id));
        if (!row) {
          throw new Error(`addRun: run ${id} not found after insert`);
        }
        return rowToRun(row);
      });
    },

    async finishArm(experimentId, agentId): Promise<ExperimentArm | null> {
      const arm = await transitionRunningArm(
        experimentId,
        agentId,
        "completed",
      );
      return arm ? rowToArm(arm) : null;
    },

    async findActiveArm(
      agentId,
      ownerId,
    ): Promise<{ experiment: Experiment; arm: ExperimentArm } | null> {
      const armRows = await db
        .select()
        .from(experimentArmsTable)
        .where(
          and(
            eq(experimentArmsTable.agentId, agentId),
            eq(experimentArmsTable.status, ARM_RUNNING),
          ),
        );
      if (armRows.length === 0) return null;

      const expRows = await db
        .select()
        .from(experimentsTable)
        .where(
          and(
            inArray(
              experimentsTable.id,
              armRows.map((a) => a.experimentId),
            ),
            eq(experimentsTable.owner, ownerId),
            eq(experimentsTable.status, RUNNING_STATUS),
          ),
        )
        .orderBy(desc(experimentsTable.createdAt))
        .limit(1);
      const expRow = expRows[0];
      if (!expRow) return null;

      const armRow = armRows.find((a) => a.experimentId === expRow.id);
      if (!armRow) return null;
      return { experiment: rowToExperiment(expRow), arm: rowToArm(armRow) };
    },

    async listInactiveRunningArms(
      deadline,
      limit,
    ): Promise<Array<{ experimentId: string; agentId: string }>> {
      return db
        .select({
          experimentId: experimentArmsTable.experimentId,
          agentId: experimentArmsTable.agentId,
        })
        .from(experimentArmsTable)
        .where(
          and(
            eq(experimentArmsTable.status, ARM_RUNNING),
            lt(experimentArmsTable.lastActivityAt, deadline),
          ),
        )
        .orderBy(asc(experimentArmsTable.lastActivityAt))
        .limit(limit);
    },

    async failInactiveArm(experimentId, agentId, deadline): Promise<boolean> {
      const arm = await transitionRunningArm(
        experimentId,
        agentId,
        "failed",
        (a) => a.lastActivityAt !== null && a.lastActivityAt < deadline,
      );
      return arm !== null;
    },
  };
}
