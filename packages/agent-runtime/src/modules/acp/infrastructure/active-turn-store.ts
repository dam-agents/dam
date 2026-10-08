import { z } from "zod";

import type { DocumentStoreBackend } from "../../../core/document-store.js";

const markerSchema = z.object({
  startedAt: z.string(),
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
  record(sessionId: string): void;
  remove(sessionId: string): void;
  bumpAttempts(sessionId: string): void;
  leftovers(): ActiveTurnMarker[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Marks the session of every turn while it runs, on
 * this pod's own disk, so the next boot can tell which turns an abnormal death
 * cut short. A marker is written when a turn starts and removed when the turn
 * ends in-process — completed, or dropped because the harness recycled — and on
 * session delete. It is deliberately NOT removed when the pod is shutting down
 * (SIGTERM), since that shutdown may be an eviction that SIGKILLs after its
 * grace period: the marker must outlive it so the next boot recovers the turn.
 * So a surviving marker names precisely a turn whose in-process end agent-
 * runtime never saw — the process went down (an OOM group-kill, an eviction)
 * with the turn still running. `attempts` counts recovery resumes so a
 * continuation that dies again cannot crash-loop the pod. The count belongs to
 * one interruption: only the turn recovery itself starts, right after bumping
 * it, keeps it on record. Any other turn is a new interruption to come and
 * starts again at zero, or one resume that died would leave the Session
 * unrecoverable for good. Only a marker inherited from the
 * previous process is a leftover. Recovery reads leftovers a few seconds after
 * boot, and a turn this process starts before that, such as the first chat
 * message after a restart, is live work: counting its marker would resume the
 * Session with an interruption notice and run a second turn nobody asked for.
 * So a session this process records or removes is no longer a leftover. Its own
 * document, separate from session metadata, so a corrupt write here cannot take
 * run accounting or user text with it.
 */
export function createActiveTurnStore(
  backend: DocumentStoreBackend,
  now: () => string = () => new Date().toISOString(),
): ActiveTurnStore {
  const store = backend.open("active-turns", {
    schema: stateSchema,
    initial: () => ({ sessions: {} }),
  });
  const inherited = new Set(Object.keys(store.read().sessions));
  const resuming = new Set<string>();

  return {
    record(sessionId) {
      inherited.delete(sessionId);
      const { sessions } = store.read();
      const attempts = resuming.delete(sessionId)
        ? (sessions[sessionId]?.attempts ?? 0)
        : 0;
      store.write({
        sessions: { ...sessions, [sessionId]: { startedAt: now(), attempts } },
      });
    },
    remove(sessionId) {
      inherited.delete(sessionId);
      resuming.delete(sessionId);
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
      resuming.add(sessionId);
      store.write({
        sessions: {
          ...sessions,
          [sessionId]: { ...existing, attempts: existing.attempts + 1 },
        },
      });
    },
    leftovers() {
      return Object.entries(store.read().sessions)
        .filter(([sessionId]) => inherited.has(sessionId))
        .map(([sessionId, marker]) => ({ sessionId, ...marker }));
    },
  };
}
