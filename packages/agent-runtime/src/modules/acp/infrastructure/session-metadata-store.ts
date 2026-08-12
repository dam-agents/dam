import { z } from "zod";
import type { DocumentStoreBackend } from "../../../core/document-store.js";

export const platformSessionMetaSchema = z.object({
  mode: z.string().optional(),
  type: z.string().optional(),
  scheduleId: z.string().optional(),
  experimentId: z.string().optional(),
  threadTs: z.string().optional(),
});

const sessionMetaEntrySchema = z.object({
  meta: platformSessionMetaSchema.catch({}),
  createdAt: z.string(),
  lastActivityAt: z.string().optional(),
  /** When a viewer last saw the session; unread = lastActivityAt > seenAt. */
  seenAt: z.string().optional(),
  /** Run accounting for machine-driven turns (scheduled fires) only, so a human
   *  reply in the same session never counts as run time. Set while one is in
   *  flight; the totals sum every fire the session has served. */
  runStartedAt: z.string().optional(),
  runTotalMs: z.number().optional(),
  runCount: z.number().optional(),
});

// A malformed entry is dropped rather than discarding the whole store.
const sessionMetadataStateSchema = z
  .object({
    sessions: z.record(z.string(), z.unknown()).default({}),
    tombstones: z.array(z.string()).default([]),
  })
  .transform(({ sessions, tombstones }) => {
    const valid: Record<string, SessionMetaEntry> = {};
    for (const [sessionId, entry] of Object.entries(sessions)) {
      const result = sessionMetaEntrySchema.safeParse(entry);
      if (result.success) valid[sessionId] = result.data;
    }
    return { sessions: valid, tombstones };
  });

export type PlatformSessionMeta = z.infer<typeof platformSessionMetaSchema>;
export type SessionMetaEntry = z.infer<typeof sessionMetaEntrySchema>;
type SessionMetadataState = z.infer<typeof sessionMetadataStateSchema>;

export interface SessionMetadataStore {
  get(sessionId: string): SessionMetaEntry | undefined;
  set(sessionId: string, meta: PlatformSessionMeta): void;
  recordActivity(sessionId: string): void;
  recordSeen(sessionId: string): void;
  startRun(sessionId: string): void;
  /** Fold the in-flight run into the totals. No-op unless one is open, so a
   *  human turn ending cannot inflate them. */
  finishRun(sessionId: string): void;
  all(): Record<string, SessionMetaEntry>;
  /** Soft delete: drop the entry and remember the id so list
   *  enrichment filters it out even while the harness still lists the JSONL. */
  tombstone(sessionId: string): void;
  isTombstoned(sessionId: string): boolean;
}

export function createSessionMetadataStore(
  backend: DocumentStoreBackend,
  now: () => string = () => new Date().toISOString(),
): SessionMetadataStore {
  const store = backend.open("session-metadata", {
    schema: sessionMetadataStateSchema,
    initial: () => ({ sessions: {}, tombstones: [] }),
  });

  // Boot fixups. One-time backfill: pre-feature entries have no seenAt and
  // would all read as unread — grandfather them as seen at their last known
  // activity. And no run can outlive the process that started it, so a
  // surviving runStartedAt means that fire died with the pod; its length is
  // unknowable, so the stamp is dropped rather than folded into the totals.
  {
    const { sessions, tombstones } = store.read();
    const stale = Object.values(sessions).some(
      (e) => e.seenAt === undefined || e.runStartedAt !== undefined,
    );
    if (stale) {
      const fixed: Record<string, SessionMetaEntry> = {};
      for (const [id, e] of Object.entries(sessions)) {
        const { runStartedAt: _abandoned, ...rest } = e;
        fixed[id] = {
          ...rest,
          seenAt: e.seenAt ?? e.lastActivityAt ?? e.createdAt,
        };
      }
      store.write({ sessions: fixed, tombstones });
    }
  }

  return {
    get(sessionId) {
      return store.read().sessions[sessionId];
    },
    set(sessionId, meta) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      // Spread rather than re-enumerate: this is a partial update (a resume
      // carrying a new mode lands here), and an allowlist rebuild would
      // silently drop every field the entry gained since it was written.
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: {
            ...existing,
            meta,
            createdAt: existing?.createdAt ?? now(),
            seenAt: existing?.seenAt ?? now(),
          },
        },
      });
    },
    recordActivity(sessionId) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (!existing) return;
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: { ...existing, lastActivityAt: now() },
        },
      });
    },
    recordSeen(sessionId) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (!existing) return;
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: { ...existing, seenAt: now() },
        },
      });
    },
    startRun(sessionId) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      // Never clobber an open run's start — a concurrent fire would discard it
      // and the next finish would be charged both.
      if (!existing || existing.runStartedAt) return;
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: { ...existing, runStartedAt: now() },
        },
      });
    },
    finishRun(sessionId) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (!existing?.runStartedAt) return;
      const { runStartedAt, ...rest } = existing;
      const measured = Date.parse(now()) - Date.parse(runStartedAt);
      // An unparseable stamp would poison the total with NaN, which the schema
      // accepts and no later run can undo.
      const elapsed = Number.isFinite(measured) ? measured : 0;
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: {
            ...rest,
            runTotalMs: (existing.runTotalMs ?? 0) + Math.max(0, elapsed),
            runCount: (existing.runCount ?? 0) + 1,
          },
        },
      });
    },
    all() {
      return store.read().sessions;
    },
    tombstone(sessionId) {
      const { sessions, tombstones } = store.read();
      if (tombstones.includes(sessionId)) return;
      const next = { ...sessions };
      delete next[sessionId];
      store.write({ sessions: next, tombstones: [...tombstones, sessionId] });
    },
    isTombstoned(sessionId) {
      return store.read().tombstones.includes(sessionId);
    },
  };
}
