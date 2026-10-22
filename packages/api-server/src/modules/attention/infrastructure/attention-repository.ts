import type { AttentionListCursor } from "api-server-api";
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
  listForOwner(ownerSub: string, limit: number): Promise<AttentionRecordRow[]>;
  listForOwnerPage(
    ownerSub: string,
    opts: { after?: AttentionListCursor | undefined; limit: number },
  ): Promise<AttentionRecordRow[]>;
  listForOwnerAgent(
    ownerSub: string,
    agentId: string,
    limit: number,
  ): Promise<AttentionRecordRow[]>;
  upsertRecord(row: AttentionRecordRow): Promise<void>;
  listDismissals(userSub: string): Promise<DismissalRow[]>;
  ownedSessionKeys(ownerSub: string): Promise<Set<string>>;
  setDismissals(
    userSub: string,
    entries: readonly { kind: AttentionItemKind; itemId: string }[],
    at: Date,
  ): Promise<void>;
  deleteSessions(agentId: string, sessionIds: readonly string[]): Promise<void>;
  deleteDismissals(
    userSub: string,
    kind: AttentionItemKind,
    itemIds: readonly string[],
  ): Promise<void>;
  deleteOlderThan(days: number): Promise<number>;
  listAgentIds(): Promise<string[]>;
  deleteForAgent(agentId: string): Promise<void>;
}

// UNIT_BOUNDARY_DESCRIPTION: a Session the owner dismissed at or after its last activity is not on the feed, whether the feed is read in one bounded page or paged; both reads share this rule so one cannot drift from the other.
function notDismissed(ownerSub: string) {
  return sql`not exists (select 1 from ${attentionState}
    where ${attentionState.userSub} = ${ownerSub}
      and ${attentionState.itemKind} = 'session'
      and ${attentionState.itemId} =
        ${attentionRecords.agentId} || ':' || ${attentionRecords.sessionId}
      and ${attentionState.dismissedAt} >=
        coalesce(${attentionRecords.activityAt}, ${attentionRecords.createdAt}))`;
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
    threadTs: row.threadTs,
    harness: row.harness,
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

    async listForOwner(ownerSub, limit) {
      const rows = await db
        .select()
        .from(attentionRecords)
        .where(
          and(eq(attentionRecords.ownerSub, ownerSub), notDismissed(ownerSub)),
        )
        .orderBy(
          desc(
            sql`coalesce(${attentionRecords.activityAt}, ${attentionRecords.createdAt})`,
          ),
        )
        .limit(limit);
      return rows.map(toRecord);
    },

    async listForOwnerPage(ownerSub, { after, limit }) {
      const at = sql`coalesce(${attentionRecords.activityAt}, ${attentionRecords.createdAt})`;
      const rows = await db
        .select()
        .from(attentionRecords)
        .where(
          and(
            eq(attentionRecords.ownerSub, ownerSub),
            notDismissed(ownerSub),
            // UNIT_BOUNDARY_DESCRIPTION: the pair (activity time, session id) is the page's whole order, so a page starts strictly after the last row the previous one returned and no row is skipped or repeated when several share a time.
            after
              ? sql`(${at}, ${attentionRecords.sessionId}) < (${new Date(after.activityAt)}, ${after.sessionId})`
              : undefined,
          ),
        )
        .orderBy(desc(at), desc(attentionRecords.sessionId))
        .limit(limit);
      return rows.map(toRecord);
    },

    async listForOwnerAgent(ownerSub, agentId, limit) {
      const rows = await db
        .select()
        .from(attentionRecords)
        .where(
          and(
            eq(attentionRecords.ownerSub, ownerSub),
            eq(attentionRecords.agentId, agentId),
          ),
        )
        .orderBy(
          desc(
            sql`coalesce(${attentionRecords.activityAt}, ${attentionRecords.createdAt})`,
          ),
        )
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
            threadTs: row.threadTs,
            harness: row.harness,
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

    async ownedSessionKeys(ownerSub) {
      const rows = await db
        .select({
          agentId: attentionRecords.agentId,
          sessionId: attentionRecords.sessionId,
        })
        .from(attentionRecords)
        .where(eq(attentionRecords.ownerSub, ownerSub));
      return new Set(rows.map((r) => `${r.agentId}:${r.sessionId}`));
    },

    async setDismissals(userSub, entries, at) {
      if (entries.length === 0) return;
      await db
        .insert(attentionState)
        .values(
          entries.map((entry) => ({
            userSub,
            itemKind: entry.kind,
            itemId: entry.itemId,
            dismissedAt: at,
            updatedAt: at,
          })),
        )
        .onConflictDoUpdate({
          target: [
            attentionState.userSub,
            attentionState.itemKind,
            attentionState.itemId,
          ],
          set: { dismissedAt: at, updatedAt: at },
        });
    },

    async deleteDismissals(userSub, kind, itemIds) {
      if (itemIds.length === 0) return;
      await db
        .delete(attentionState)
        .where(
          and(
            eq(attentionState.userSub, userSub),
            eq(attentionState.itemKind, kind),
            inArray(attentionState.itemId, [...itemIds]),
          ),
        );
    },

    async deleteSessions(agentId, sessionIds) {
      if (sessionIds.length === 0) return;
      await db.delete(attentionState).where(
        and(
          eq(attentionState.itemKind, "session"),
          inArray(
            attentionState.itemId,
            sessionIds.map((sessionId) => `${agentId}:${sessionId}`),
          ),
        ),
      );
      await db
        .delete(attentionRecords)
        .where(
          and(
            eq(attentionRecords.agentId, agentId),
            inArray(attentionRecords.sessionId, [...sessionIds]),
          ),
        );
    },

    async deleteOlderThan(days) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000);
      const isStale = or(
        lt(attentionRecords.activityAt, cutoff),
        and(
          sql`${attentionRecords.activityAt} is null`,
          lt(attentionRecords.createdAt, cutoff),
        ),
      );
      await db
        .delete(attentionState)
        .where(
          and(
            eq(attentionState.itemKind, "approval"),
            lt(attentionState.dismissedAt, cutoff),
          ),
        );
      const stale = await db
        .select({
          agentId: attentionRecords.agentId,
          sessionId: attentionRecords.sessionId,
        })
        .from(attentionRecords)
        .where(isStale);
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
      await db.delete(attentionRecords).where(isStale);
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
