import { randomBytes } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  type Db,
  experiments as experimentsTable,
  experimentArms as experimentArmsTable,
  experimentRuns as experimentRunsTable,
} from "db";
import type {
  Experiment,
  ExperimentArm,
  ExperimentConfig,
  ExperimentRun,
  ExperimentStatus,
} from "api-server-api";

const RUNNING_STATUS: ExperimentStatus = "running";

export interface ExperimentsRepository {
  create(input: {
    ownerId: string;
    name: string;
    goal: string;
    spec: ExperimentConfig;
  }): Promise<Experiment>;
  listByOwner(ownerId: string): Promise<Experiment[]>;
  get(id: string, ownerId: string): Promise<Experiment | null>;
  delete(id: string, ownerId: string): Promise<void>;

  addArm(input: {
    experimentId: string;
    agentId: string;
    armSpec: ExperimentConfig;
  }): Promise<ExperimentArm>;
  listArms(experimentId: string): Promise<ExperimentArm[]>;
  listRuns(experimentId: string): Promise<ExperimentRun[]>;

  /** The arm of the owner's single running experiment that contains `agentId`,
   *  or null. Owner-scoped so a leaked agentId can't reach another tenant. */
  findActiveArm(
    agentId: string,
    ownerId: string,
  ): Promise<{ experiment: Experiment; arm: ExperimentArm } | null>;
}

type ExperimentRow = typeof experimentsTable.$inferSelect;
type ArmRow = typeof experimentArmsTable.$inferSelect;
type RunRow = typeof experimentRunsTable.$inferSelect;

function rowToExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    ownerId: row.owner,
    name: row.name,
    goal: row.goal,
    spec: (row.spec as ExperimentConfig) ?? {},
    status: row.status as ExperimentStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToArm(row: ArmRow): ExperimentArm {
  return {
    experimentId: row.experimentId,
    agentId: row.agentId,
    armSpec: (row.armSpec as ExperimentConfig) ?? {},
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
  return {
    async create(input): Promise<Experiment> {
      const id = `exp-${randomBytes(6).toString("hex")}`;
      await db.insert(experimentsTable).values({
        id,
        owner: input.ownerId,
        name: input.name,
        goal: input.goal,
        spec: input.spec,
      });
      const created = await this.get(id, input.ownerId);
      if (!created) {
        throw new Error(`create: experiment ${id} not found after insert`);
      }
      return created;
    },

    async listByOwner(ownerId): Promise<Experiment[]> {
      const rows = await db
        .select()
        .from(experimentsTable)
        .where(eq(experimentsTable.owner, ownerId))
        .orderBy(desc(experimentsTable.createdAt));
      return rows.map(rowToExperiment);
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
        armSpec: input.armSpec,
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

    async findActiveArm(
      agentId,
      ownerId,
    ): Promise<{ experiment: Experiment; arm: ExperimentArm } | null> {
      const armRows = await db
        .select()
        .from(experimentArmsTable)
        .where(eq(experimentArmsTable.agentId, agentId));
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
  };
}
