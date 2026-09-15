import {
  and,
  attentionRecords,
  attentionState,
  desc,
  eq,
  inArray,
  lt,
  or,
  sql,
  type Db,
} from "db";

import {
  type AttentionItemKind,
  type AttentionRecordRow,
  type DismissalRow,
} from "../domain/types.js";

type RawRecord = typeof attentionRecords.$inferSelect;
type RawState = typeof attentionState.$inferSelect;

export interface AttentionRepository {
  listForAgent(agentId: string): Promise<AttentionRecordRow[]>;
  getRecord(
    agentId: string,
    sessionId: string,
  ): Promise<AttentionRecordRow | null>;
  listForOwner(ownerSub: string, limit: number): Promise<AttentionRecordRow[]>;
  upsertRecord(row: AttentionRecordRow): Promise<void>;
  listDismissals(userSub: string): Promise<DismissalRow[]>;
  getDismissal(
    userSub: string,
    kind: AttentionItemKind,
    itemId: string,
  ): Promise<DismissalRow | null>;
  setDismissal(
    userSub: string,
    kind: AttentionItemKind,
    itemId: string,
    at: Date,
  ): Promise<void>;
  deleteOlderThan(days: number): Promise<number>;
  listAgentIds(): Promise<string[]>;
  deleteForAgent(agentId: string): Promise<void>;
}

function toRecord(row: RawRecord): AttentionRecordRow {
  return {
    agentId: row.agentId,
    sessionId: row.sessionId,
    ownerSub: row.ownerSub,
    mode: row.mode,
    type: row.type,
    title: row.title,
    scheduleId: row.scheduleId,
    experimentId: row.experimentId,
    createdAt: row.createdAt,
    activityAt: row.activityAt,
    seenAt: row.seenAt,
    working: row.working,
  };
}

function toDismissal(row: RawState): DismissalRow {
  return {
    kind: row.itemKind as AttentionItemKind,
    itemId: row.itemId,
    dismissedAt: row.dismissedAt,
  };
}

export function createAttentionRepository(db: Db): AttentionRepository {
  return {
    async listForAgent(agentId) {
      const rows = await db
        .select()
        .from(attentionRecords)
        .where(eq(attentionRecords.agentId, agentId));
      return rows.map(toRecord);
    },

    async getRecord(agentId, sessionId) {
      const [row] = await db
        .select()
        .from(attentionRecords)
        .where(
          and(
            eq(attentionRecords.agentId, agentId),
            eq(attentionRecords.sessionId, sessionId),
          ),
        )
        .limit(1);
      return row ? toRecord(row) : null;
    },

    async listForOwner(ownerSub, limit) {
      const rows = await db
        .select()
        .from(attentionRecords)
        .where(eq(attentionRecords.ownerSub, ownerSub))
        .orderBy(desc(attentionRecords.activityAt))
        .limit(limit);
      return rows.map(toRecord);
    },

    async upsertRecord(row) {
      await db
        .insert(attentionRecords)
        .values({ ...row, capturedAt: new Date() })
        .onConflictDoUpdate({
          target: [attentionRecords.agentId, attentionRecords.sessionId],
          set: {
            ownerSub: row.ownerSub,
            mode: row.mode,
            type: row.type,
            title: row.title,
            scheduleId: row.scheduleId,
            experimentId: row.experimentId,
            createdAt: row.createdAt,
            activityAt: row.activityAt,
            seenAt: row.seenAt,
            working: row.working,
            capturedAt: new Date(),
          },
        });
    },

    async listDismissals(userSub) {
      const rows = await db
        .select()
        .from(attentionState)
        .where(eq(attentionState.userSub, userSub));
      return rows.map(toDismissal);
    },

    async getDismissal(userSub, kind, itemId) {
      const [row] = await db
        .select()
        .from(attentionState)
        .where(
          and(
            eq(attentionState.userSub, userSub),
            eq(attentionState.itemKind, kind),
            eq(attentionState.itemId, itemId),
          ),
        )
        .limit(1);
      return row ? toDismissal(row) : null;
    },

    async setDismissal(userSub, kind, itemId, at) {
      await db
        .insert(attentionState)
        .values({
          userSub,
          itemKind: kind,
          itemId,
          dismissedAt: at,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            attentionState.userSub,
            attentionState.itemKind,
            attentionState.itemId,
          ],
          set: { dismissedAt: at, updatedAt: new Date() },
        });
    },

    async deleteOlderThan(days) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000);
      const stale = await db
        .select({
          agentId: attentionRecords.agentId,
          sessionId: attentionRecords.sessionId,
        })
        .from(attentionRecords)
        .where(
          or(
            lt(attentionRecords.activityAt, cutoff),
            and(
              sql`${attentionRecords.activityAt} is null`,
              lt(attentionRecords.createdAt, cutoff),
            ),
          ),
        );
      if (stale.length === 0) return 0;

      const itemIds = stale.map((r) => `${r.agentId}:${r.sessionId}`);
      await db
        .delete(attentionState)
        .where(
          and(
            eq(attentionState.itemKind, "session"),
            inArray(attentionState.itemId, itemIds),
          ),
        );
      await db
        .delete(attentionRecords)
        .where(
          or(
            lt(attentionRecords.activityAt, cutoff),
            and(
              sql`${attentionRecords.activityAt} is null`,
              lt(attentionRecords.createdAt, cutoff),
            ),
          ),
        );
      return stale.length;
    },

    async listAgentIds() {
      const rows = await db
        .selectDistinct({ agentId: attentionRecords.agentId })
        .from(attentionRecords);
      return rows.map((r) => r.agentId);
    },

    async deleteForAgent(agentId) {
      const rows = await db
        .select({ sessionId: attentionRecords.sessionId })
        .from(attentionRecords)
        .where(eq(attentionRecords.agentId, agentId));
      if (rows.length > 0) {
        await db.delete(attentionState).where(
          and(
            eq(attentionState.itemKind, "session"),
            inArray(
              attentionState.itemId,
              rows.map((r) => `${agentId}:${r.sessionId}`),
            ),
          ),
        );
      }
      await db
        .delete(attentionRecords)
        .where(eq(attentionRecords.agentId, agentId));
    },
  };
}
