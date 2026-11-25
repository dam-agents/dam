import { and, desc, eq, inArray, sessionPins, type Db } from "db";
import type { SessionPinKey } from "api-server-api";

export interface StoredSessionPin extends SessionPinKey {
  pinnedAt: Date;
}

export interface SessionPinsRepository {
  listForOwner(owner: string): Promise<StoredSessionPin[]>;
  insert(owner: string, key: SessionPinKey): Promise<void>;
  delete(owner: string, key: SessionPinKey): Promise<void>;
  listPinnedSessionKeys(): Promise<Set<string>>;
  listAgentIds(): Promise<string[]>;
  deleteForAgent(agentId: string): Promise<void>;
  deleteSessions(agentId: string, sessionIds: readonly string[]): Promise<void>;
}

export function createSessionPinsRepository(db: Db): SessionPinsRepository {
  return {
    async listForOwner(owner) {
      return db
        .select({
          agentId: sessionPins.agentId,
          sessionId: sessionPins.sessionId,
          pinnedAt: sessionPins.pinnedAt,
        })
        .from(sessionPins)
        .where(eq(sessionPins.owner, owner))
        .orderBy(desc(sessionPins.pinnedAt));
    },

    async insert(owner, key) {
      await db
        .insert(sessionPins)
        .values({ owner, agentId: key.agentId, sessionId: key.sessionId })
        .onConflictDoNothing();
    },

    async delete(owner, key) {
      await db
        .delete(sessionPins)
        .where(
          and(
            eq(sessionPins.owner, owner),
            eq(sessionPins.agentId, key.agentId),
            eq(sessionPins.sessionId, key.sessionId),
          ),
        );
    },

    async listPinnedSessionKeys() {
      const rows = await db
        .selectDistinct({
          agentId: sessionPins.agentId,
          sessionId: sessionPins.sessionId,
        })
        .from(sessionPins);
      return new Set(rows.map((row) => `${row.agentId}:${row.sessionId}`));
    },

    async listAgentIds() {
      const rows = await db
        .selectDistinct({ agentId: sessionPins.agentId })
        .from(sessionPins);
      return rows.map((row) => row.agentId);
    },

    async deleteForAgent(agentId) {
      await db.delete(sessionPins).where(eq(sessionPins.agentId, agentId));
    },

    async deleteSessions(agentId, sessionIds) {
      if (sessionIds.length === 0) return;
      await db
        .delete(sessionPins)
        .where(
          and(
            eq(sessionPins.agentId, agentId),
            inArray(sessionPins.sessionId, [...sessionIds]),
          ),
        );
    },
  };
}
