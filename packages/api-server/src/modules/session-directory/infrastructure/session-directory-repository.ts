import {
  podSessionTypeSchema,
  type SessionDirectoryEntry,
} from "agent-runtime-api";
import {
  sessionModeSchema,
  type SessionMode,
  type SessionType,
} from "api-server-api";
import { agentSessions, and, inArray, lt, sql, type Db } from "db";

export interface StoredSession {
  sessionId: string;
  mode: SessionMode;
  type: SessionType;
}

function parseStoredSession(row: {
  sessionId: string;
  mode: string;
  type: string;
}): StoredSession | null {
  const mode = sessionModeSchema.safeParse(row.mode);
  const type = podSessionTypeSchema.safeParse(row.type);
  if (!mode.success || !type.success) return null;
  return { sessionId: row.sessionId, mode: mode.data, type: type.data };
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
  deleteOlderThan(days: number): Promise<number>;
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
      const rows = await db
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
      return rows.flatMap((row) => parseStoredSession(row) ?? []);
    },

    async deleteOlderThan(days) {
      const result = await db
        .delete(agentSessions)
        .where(
          lt(
            agentSessions.createdAt,
            sql`now() - make_interval(days => ${days})`,
          ),
        );
      return (result as unknown as { rowCount?: number }).rowCount ?? 0;
    },
  };
}
