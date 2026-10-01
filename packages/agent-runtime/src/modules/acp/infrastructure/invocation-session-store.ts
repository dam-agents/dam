import { z } from "zod";

import type { DocumentStoreBackend } from "../../../core/document-store.js";

const MAX_ENTRIES = 1_000;

const stateSchema = z.object({
  sessions: z.record(z.string(), z.string()).default({}),
});

export interface InvocationSessionStore {
  record(sessionId: string, invocationIds: string[]): void;
  sessionOf(invocationIds: readonly string[]): string | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which Session started each Invocation, kept on the
 * pod's own disk so it survives the hibernation an outcome may wake the Agent
 * from. Only the newest entries are kept; an Invocation outliving them opens
 * its outcome in a new Session instead.
 */
export function createInvocationSessionStore(
  backend: DocumentStoreBackend,
): InvocationSessionStore {
  const store = backend.open("invocation-sessions", {
    schema: stateSchema,
    initial: () => ({ sessions: {} }),
  });

  return {
    record(sessionId, invocationIds) {
      const { sessions } = store.read();
      const next = { ...sessions };
      for (const id of invocationIds) {
        delete next[id];
        next[id] = sessionId;
      }
      const entries = Object.entries(next);
      store.write({
        sessions: Object.fromEntries(entries.slice(-MAX_ENTRIES)),
      });
    },

    sessionOf(invocationIds) {
      const { sessions } = store.read();
      for (const id of invocationIds) {
        const sessionId = sessions[id];
        if (sessionId) return sessionId;
      }
      return null;
    },
  };
}
