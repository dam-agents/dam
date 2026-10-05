import { z } from "zod";

import type { DocumentStoreBackend } from "../../../core/document-store.js";

const MAX_ENTRIES = 1_000;

const stateSchema = z.object({
  sessions: z.record(z.string(), z.string()).default({}),
});

export interface SubAgentSessionStore {
  record(sessionId: string, subAgentIds: string[]): void;
  sessionOf(subAgentIds: readonly string[]): string | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which Session spawned each sub-agent, kept on the
 * pod's own disk so it survives the hibernation an outcome may wake the Agent
 * from. Only the newest entries are kept; a sub-agent outliving them opens
 * its outcome in a new Session instead.
 */
export function createSubAgentSessionStore(
  backend: DocumentStoreBackend,
): SubAgentSessionStore {
  const store = backend.open("sub-agent-sessions", {
    schema: stateSchema,
    initial: () => ({ sessions: {} }),
  });

  return {
    record(sessionId, subAgentIds) {
      const { sessions } = store.read();
      const next = { ...sessions };
      for (const id of subAgentIds) {
        delete next[id];
        next[id] = sessionId;
      }
      const entries = Object.entries(next);
      store.write({
        sessions: Object.fromEntries(entries.slice(-MAX_ENTRIES)),
      });
    },

    sessionOf(subAgentIds) {
      const { sessions } = store.read();
      for (const id of subAgentIds) {
        const sessionId = sessions[id];
        if (sessionId) return sessionId;
      }
      return null;
    },
  };
}
