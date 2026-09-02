import type { SessionDirectoryEntry } from "agent-runtime-api";
import { agentSessions, and, inArray, sql, type Db } from "db";

export interface StoredSession {
  sessionId: string;
  mode: string;
  type: string;
}

export interface SessionDirectoryRepository {
  record(
    agentId: string,
    sessions: readonly SessionDirectoryEntry[],
  ): Promise<void>;
  find(
    agentIds: readonly string[],
    sessionIds: readonly string[],
  ): Promise<StoredSession[]>;
}

export function createSessionDirectoryRepository(
  db: Db,
): SessionDirectoryRepository {
  return {
    async record(agentId, sessions) {
      if (sessions.length === 0) return;
      await db
        .insert(agentSessions)
        .values(
          sessions.map((s) => ({
            agentId,
            sessionId: s.sessionId,
            mode: s.mode,
            type: s.type,
            createdAt: new Date(s.createdAt),
          })),
        )
        .onConflictDoUpdate({
          target: [agentSessions.agentId, agentSessions.sessionId],
          set: {
            mode: sql`excluded.mode`,
            type: sql`excluded.type`,
            reportedAt: sql`now()`,
          },
        });
    },

    async find(agentIds, sessionIds) {
      if (agentIds.length === 0 || sessionIds.length === 0) return [];
      return db
        .select({
          sessionId: agentSessions.sessionId,
          mode: agentSessions.mode,
          type: agentSessions.type,
        })
        .from(agentSessions)
        .where(
          and(
            inArray(agentSessions.agentId, [...agentIds]),
            inArray(agentSessions.sessionId, [...sessionIds]),
          ),
        );
    },
  };
}
