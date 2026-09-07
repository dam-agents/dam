import { z } from "zod";

import type { DocumentStoreBackend } from "../../../core/document-store.js";

export type TurnOrigin = "machine" | "interactive";

const markerSchema = z.object({
  startedAt: z.string(),
  origin: z.enum(["machine", "interactive"]),
  attempts: z.number().int().nonnegative().default(0),
});
export type ActiveTurnMarker = z.infer<typeof markerSchema> & {
  sessionId: string;
};

const stateSchema = z
  .object({ sessions: z.record(z.string(), z.unknown()).default({}) })
  .transform(({ sessions }) => {
    const valid: Record<string, z.infer<typeof markerSchema>> = {};
    for (const [sessionId, entry] of Object.entries(sessions)) {
      const parsed = markerSchema.safeParse(entry);
      if (parsed.success) valid[sessionId] = parsed.data;
    }
    return { sessions: valid };
  });

export interface ActiveTurnStore {
  record(sessionId: string, origin: TurnOrigin): void;
  remove(sessionId: string): void;
  bumpAttempts(sessionId: string): void;
  clearAll(): void;
  leftovers(): ActiveTurnMarker[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Marks the session of every turn while it runs, on
 * this pod's own disk, so the next boot can tell which turns an abnormal death
 * cut short. A marker is written when a turn starts and removed only when that
 * turn *completes* — a turn dropped because the harness died stays marked,
 * since that is exactly the interruption to recover from. It is removed on
 * session delete and on graceful shutdown (SIGTERM is hibernation or a
 * deliberate stop, not a crash). `attempts` counts recovery resumes so a
 * continuation that dies again cannot crash-loop the pod; a re-record of a
 * still-marked session preserves its count. Its own document, separate from
 * session metadata, so a corrupt write here cannot take run accounting or user
 * text with it.
 */
export function createActiveTurnStore(
  backend: DocumentStoreBackend,
  now: () => string = () => new Date().toISOString(),
): ActiveTurnStore {
  const store = backend.open("active-turns", {
    schema: stateSchema,
    initial: () => ({ sessions: {} }),
  });

  return {
    record(sessionId, origin) {
      const { sessions } = store.read();
      const existing = sessions[sessionId];
      store.write({
        sessions: {
          ...sessions,
          [sessionId]: {
            startedAt: now(),
            origin,
            attempts: existing?.attempts ?? 0,
          },
        },
      });
    },
    remove(sessionId) {
      const { sessions } = store.read();
      if (sessions[sessionId] === undefined) return;
      const next = { ...sessions };
      delete next[sessionId];
      store.write({ sessions: next });
    },
    bumpAttempts(sessionId) {
      const { sessions } = store.read();
      const existing = sessions[sessionId];
      if (existing === undefined) return;
      store.write({
        sessions: {
          ...sessions,
          [sessionId]: { ...existing, attempts: existing.attempts + 1 },
        },
      });
    },
    clearAll() {
      if (Object.keys(store.read().sessions).length === 0) return;
      store.write({ sessions: {} });
    },
    leftovers() {
      return Object.entries(store.read().sessions).map(
        ([sessionId, marker]) => ({ sessionId, ...marker }),
      );
    },
  };
}
