import {
  sessionCategoryOf,
  type SessionCategory,
  type SessionDirectoryService,
} from "api-server-api";

import { boundedSet } from "../../../core/bounded-map.js";
import type { SessionDirectoryRepository } from "../infrastructure/session-directory-repository.js";

export interface SessionDirectory extends SessionDirectoryService {
  categorize(
    agentIds: readonly string[],
    sessionIds: readonly string[],
  ): Promise<Map<string, SessionCategory>>;
  has(agentId: string, sessionId: string): Promise<boolean>;
}

const KNOWN_TTL_MS = 10 * 60 * 1000;
const KNOWN_MAX = 10_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: `has` answers the spend ledger for each record
 * of a stamped call, so a Session it found stays known for a while. A miss is
 * never kept, because a new Session's report can arrive after its first call.
 */
export function createSessionDirectoryService(deps: {
  repo: SessionDirectoryRepository;
}): SessionDirectory {
  const known = new Map<string, number>();
  return {
    record: (agentId, sessions) => deps.repo.record(agentId, sessions),

    async has(agentId, sessionId) {
      const key = `${agentId}\u0000${sessionId}`;
      const at = known.get(key);
      if (at !== undefined && Date.now() - at < KNOWN_TTL_MS) return true;
      known.delete(key);
      const rows = await deps.repo.find([agentId], [sessionId]);
      if (rows.length === 0) return false;
      boundedSet(known, key, Date.now(), KNOWN_MAX);
      return true;
    },

    async categorize(agentIds, sessionIds) {
      const rows = await deps.repo.find(agentIds, sessionIds);
      return new Map<string, SessionCategory>(
        rows.map((row) => [row.sessionId, sessionCategoryOf(row)]),
      );
    },
  };
}
