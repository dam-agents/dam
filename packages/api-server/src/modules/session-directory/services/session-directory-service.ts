import type { SessionDirectoryEntry } from "agent-runtime-api";
import {
  sessionCategoryOf,
  type SessionCategory,
  type SessionDirectoryService,
} from "api-server-api";

import type { SessionDirectoryRepository } from "../infrastructure/session-directory-repository.js";

export interface SessionDirectory extends SessionDirectoryService {
  categorize(
    agentIds: readonly string[],
    sessionIds: readonly string[],
  ): Promise<Map<string, SessionCategory>>;
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
      return new Map<string, SessionCategory>(
        rows.map((row) => [row.sessionId, sessionCategoryOf(row)]),
      );
    },
  };
}
