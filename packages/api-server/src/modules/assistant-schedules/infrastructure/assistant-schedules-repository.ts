import { and, assistantSchedules, eq, type Db } from "db";

export interface AssistantScheduleRow {
  agentId: string;
  scheduleId: string | null;
  items: string[];
  reportedAt: Date | null;
}

export interface AssistantSchedulesRepository {
  find(owner: string, kind: string): Promise<AssistantScheduleRow | null>;
  save(
    owner: string,
    kind: string,
    schedule: { agentId: string; scheduleId: string },
  ): Promise<void>;
  report(
    owner: string,
    kind: string,
    items: readonly string[],
    at: Date,
  ): Promise<AssistantScheduleRow | null>;
  delete(owner: string, kind: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
  deleteForAgent(agentId: string): Promise<void>;
}

const toRow = (row: AssistantScheduleRow): AssistantScheduleRow => ({
  agentId: row.agentId,
  scheduleId: row.scheduleId,
  items: row.items,
  reportedAt: row.reportedAt,
});

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Schedules the platform gave a person's
 * assistant, one row per owner and kind: the Agent, the Schedule, and the
 * last alert a run of it raised. Saving a Schedule starts its row over, so an
 * alert about an earlier Schedule or Agent never shows beside a new one. An
 * alert only lands on a row that exists, which is what keeps a person the
 * platform gave no such Schedule from getting one.
 */
export function createAssistantSchedulesRepository(
  db: Db,
): AssistantSchedulesRepository {
  const rowOf = (owner: string, kind: string) =>
    and(eq(assistantSchedules.owner, owner), eq(assistantSchedules.kind, kind));

  return {
    async find(owner, kind) {
      const [row] = await db
        .select()
        .from(assistantSchedules)
        .where(rowOf(owner, kind));
      return row ? toRow(row) : null;
    },

    async save(owner, kind, schedule) {
      await db
        .insert(assistantSchedules)
        .values({ owner, kind, ...schedule })
        .onConflictDoUpdate({
          target: [assistantSchedules.owner, assistantSchedules.kind],
          set: { ...schedule, items: [], reportedAt: null },
        });
    },

    async report(owner, kind, items, at) {
      const [row] = await db
        .update(assistantSchedules)
        .set({ items: [...items], reportedAt: at })
        .where(rowOf(owner, kind))
        .returning();
      return row ? toRow(row) : null;
    },

    async delete(owner, kind) {
      await db.delete(assistantSchedules).where(rowOf(owner, kind));
    },

    async listAgentIds() {
      const rows = await db
        .selectDistinct({ agentId: assistantSchedules.agentId })
        .from(assistantSchedules);
      return rows.map((r) => r.agentId);
    },

    async deleteForAgent(agentId) {
      await db
        .delete(assistantSchedules)
        .where(eq(assistantSchedules.agentId, agentId));
    },
  };
}
