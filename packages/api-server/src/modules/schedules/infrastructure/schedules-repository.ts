import { randomBytes } from "node:crypto";
import { and, asc, eq, type Db, schedules as schedulesTable } from "db";
import type { Schedule, ScheduleSpec } from "api-server-api";
import { scheduleSpecSchema } from "api-server-api";

export interface SchedulesRepository {
  list(agentId: string, owner: string): Promise<Schedule[]>;
  get(id: string, owner: string): Promise<Schedule | null>;
  getById(id: string): Promise<Schedule | null>;
  getOwnerById(id: string): Promise<string | null>;
  listAllEnabled(): Promise<Schedule[]>;
  create(input: {
    agentId: string;
    owner: string;
    name: string;
    spec: ScheduleSpec;
  }): Promise<Schedule>;
  updateSpec(
    id: string,
    owner: string,
    spec: ScheduleSpec,
  ): Promise<Schedule | null>;
  updateName(id: string, owner: string, name: string): Promise<Schedule | null>;
  delete(id: string, owner: string): Promise<void>;
  toggle(id: string, owner: string): Promise<Schedule | null>;
  recordFire(id: string, result: string, nextRun: Date | null): Promise<void>;
  setNextRun(id: string, nextRun: Date | null): Promise<void>;
}

interface InternalRow {
  id: string;
  agentId: string;
  owner: string;
  name: string;
  spec: unknown;
  enabled: boolean;
  nextRun: Date | null;
  lastFiredAt: Date | null;
  lastFiredResult: string | null;
}

function rowToSchedule(row: InternalRow): Schedule {
  const spec = scheduleSpecSchema.parse(row.spec);
  spec.enabled = row.enabled;
  const status: Schedule["status"] = {
    ...(row.lastFiredAt ? { lastRun: row.lastFiredAt.toISOString() } : {}),
    ...(row.nextRun ? { nextRun: row.nextRun.toISOString() } : {}),
    ...(row.lastFiredResult ? { lastResult: row.lastFiredResult } : {}),
  };
  return {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    spec,
    ...(Object.keys(status).length > 0 ? { status } : {}),
  };
}

export function createSchedulesRepository(db: Db): SchedulesRepository {
  return {
    async list(agentId, owner): Promise<Schedule[]> {
      const rows = (await db
        .select()
        .from(schedulesTable)
        .where(
          and(
            eq(schedulesTable.agentId, agentId),
            eq(schedulesTable.owner, owner),
          ),
        )
        .orderBy(asc(schedulesTable.createdAt))) as InternalRow[];
      return rows.map(rowToSchedule);
    },

    async get(id, owner): Promise<Schedule | null> {
      const rows = (await db
        .select()
        .from(schedulesTable)
        .where(
          and(eq(schedulesTable.id, id), eq(schedulesTable.owner, owner)),
        )) as InternalRow[];
      return rows[0] ? rowToSchedule(rows[0]) : null;
    },

    async getById(id): Promise<Schedule | null> {
      const rows = (await db
        .select()
        .from(schedulesTable)
        .where(eq(schedulesTable.id, id))) as InternalRow[];
      return rows[0] ? rowToSchedule(rows[0]) : null;
    },

    async getOwnerById(id): Promise<string | null> {
      const rows = (await db
        .select({ owner: schedulesTable.owner })
        .from(schedulesTable)
        .where(eq(schedulesTable.id, id))) as { owner: string }[];
      return rows[0]?.owner ?? null;
    },

    async listAllEnabled(): Promise<Schedule[]> {
      const rows = (await db
        .select()
        .from(schedulesTable)
        .where(eq(schedulesTable.enabled, true))) as InternalRow[];
      return rows.map(rowToSchedule);
    },

    async create(input): Promise<Schedule> {
      const id = `sched-${randomBytes(6).toString("hex")}`;
      await db.insert(schedulesTable).values({
        id,
        agentId: input.agentId,
        owner: input.owner,
        name: input.name,
        spec: input.spec,
        enabled: input.spec.enabled,
      });
      const result = await this.get(id, input.owner);
      if (!result)
        throw new Error(`create: schedule ${id} not found after insert`);
      return result;
    },

    async updateSpec(id, owner, spec): Promise<Schedule | null> {
      const result = await db
        .update(schedulesTable)
        .set({ spec, enabled: spec.enabled, updatedAt: new Date() })
        .where(and(eq(schedulesTable.id, id), eq(schedulesTable.owner, owner)))
        .returning();
      if (result.length === 0) return null;
      return this.get(id, owner);
    },

    async updateName(id, owner, name): Promise<Schedule | null> {
      const result = await db
        .update(schedulesTable)
        .set({ name, updatedAt: new Date() })
        .where(and(eq(schedulesTable.id, id), eq(schedulesTable.owner, owner)))
        .returning();
      if (result.length === 0) return null;
      return this.get(id, owner);
    },

    async delete(id, owner): Promise<void> {
      await db
        .delete(schedulesTable)
        .where(and(eq(schedulesTable.id, id), eq(schedulesTable.owner, owner)));
    },

    async toggle(id, owner): Promise<Schedule | null> {
      const current = await this.get(id, owner);
      if (!current) return null;
      const enabled = !current.spec.enabled;
      const spec: ScheduleSpec = { ...current.spec, enabled };
      return this.updateSpec(id, owner, spec);
    },

    async recordFire(id, result, nextRun): Promise<void> {
      await db
        .update(schedulesTable)
        .set({
          lastFiredAt: new Date(),
          lastFiredResult: result,
          nextRun,
          updatedAt: new Date(),
        })
        .where(eq(schedulesTable.id, id));
    },

    async setNextRun(id, nextRun): Promise<void> {
      await db
        .update(schedulesTable)
        .set({ nextRun, updatedAt: new Date() })
        .where(eq(schedulesTable.id, id));
    },
  };
}
