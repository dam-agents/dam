import { z } from "zod";
import type { DocumentStoreBackend } from "../../../core/document-store.js";

export const platformSessionMetaSchema = z.object({
  mode: z.string().optional(),
  type: z.string().optional(),
  scheduleId: z.string().optional(),
  initialization: z.boolean().optional(),
  threadTs: z.string().optional(),
});

const sessionMetaEntrySchema = z.object({
  meta: platformSessionMetaSchema.catch({}),
  createdAt: z.string(),
  lastActivityAt: z.string().optional(),
  seenAt: z.string().optional(),
  runStartedAt: z.string().optional(),
  runTotalMs: z.number().optional(),
  runCount: z.number().optional(),
  runStarts: z.array(z.string()).optional(),
});

const RUN_STARTS_CAP = 500;

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
  startRun(sessionId: string): string | null;
  finishRun(sessionId: string): void;
  runStartsOf(sessionId: string): string[];
  all(): Record<string, SessionMetaEntry>;
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
      if (!existing || existing.runStartedAt) return null;
      const stamp = now();
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: {
            ...existing,
            runStartedAt: stamp,
            runStarts: [...(existing.runStarts ?? []), stamp].slice(
              -RUN_STARTS_CAP,
            ),
          },
        },
      });
      return stamp;
    },
    finishRun(sessionId) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      if (!existing?.runStartedAt) return;
      const { runStartedAt, ...rest } = existing;
      const measured = Date.parse(now()) - Date.parse(runStartedAt);
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
    runStartsOf(sessionId) {
      return [...(store.read().sessions[sessionId]?.runStarts ?? [])];
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
