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

  // One-time backfill: pre-feature entries have no seenAt and would all read
  // as unread. Grandfather them as seen at their last known activity.
  {
    const { sessions, tombstones } = store.read();
    if (Object.values(sessions).some((e) => e.seenAt === undefined)) {
      const backfilled: Record<string, SessionMetaEntry> = {};
      for (const [id, e] of Object.entries(sessions)) {
        backfilled[id] = {
          ...e,
          seenAt: e.seenAt ?? e.lastActivityAt ?? e.createdAt,
        };
      }
      store.write({ sessions: backfilled, tombstones });
    }
  }

  return {
    get(sessionId) {
      return store.read().sessions[sessionId];
    },
    set(sessionId, meta) {
      const { sessions, tombstones } = store.read();
      const existing = sessions[sessionId];
      const lastActivityAt = existing?.lastActivityAt;
      const seenAt = existing?.seenAt ?? now();
      store.write({
        tombstones,
        sessions: {
          ...sessions,
          [sessionId]: {
            meta,
            createdAt: existing?.createdAt ?? now(),
            ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
            seenAt,
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
