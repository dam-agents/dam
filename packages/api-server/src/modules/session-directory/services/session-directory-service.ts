import {
  podSessionModeSchema,
  podSessionTypeSchema,
  type SessionDirectoryEntry,
} from "agent-runtime-api";
import {
  sessionCategoryOf,
  SessionMode,
  type SessionCategory,
  type SessionDirectoryService,
  type SessionType,
} from "api-server-api";

import type {
  SessionDirectoryRepository,
  StoredSession,
} from "../infrastructure/session-directory-repository.js";

export interface SessionDirectory extends SessionDirectoryService {
  categorize(
    agentIds: readonly string[],
    sessionIds: readonly string[],
  ): Promise<Map<string, SessionCategory>>;
}

function categoryOf(row: StoredSession): SessionCategory | null {
  const mode = podSessionModeSchema.safeParse(row.mode);
  const type = podSessionTypeSchema.safeParse(row.type);
  if (!mode.success || !type.success) return null;
  return sessionCategoryOf({
    mode: mode.data as SessionMode,
    type: type.data as SessionType,
  });
}

export function createSessionDirectoryService(deps: {
  repo: SessionDirectoryRepository;
}): SessionDirectory {
  return {
    async record(agentId: string, sessions: readonly SessionDirectoryEntry[]) {
      await deps.repo.record(agentId, sessions);
    },

    async categorize(agentIds, sessionIds) {
      const rows = await deps.repo.find(agentIds, sessionIds);
      const bySession = new Map<string, SessionCategory>();
      for (const row of rows) {
        const category = categoryOf(row);
        if (category) bySession.set(row.sessionId, category);
      }
      return bySession;
    },
  };
}
