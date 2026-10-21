import {
  platformContinuedFromSchema,
  type PlatformContinuedFrom,
} from "api-server-api";
import { z } from "zod";

import type { DocumentStoreBackend } from "../../../core/document-store.js";

const BYTES_CAP = 16 * 1024 * 1024;

const sessionEntrySchema = z.object({
  seed: platformContinuedFromSchema,
  sent: z.boolean(),
  savedAt: z.string(),
});
type SessionEntry = z.infer<typeof sessionEntrySchema>;

const stateSchema = z
  .object({
    sessions: z.record(z.string(), z.unknown()).default({}),
  })
  .transform(({ sessions }) => {
    const valid: Record<string, SessionEntry> = {};
    for (const [sessionId, entry] of Object.entries(sessions)) {
      const parsed = sessionEntrySchema.safeParse(entry);
      if (parsed.success) valid[sessionId] = parsed.data;
    }
    return { sessions: valid };
  });

export interface ContinuedFromStore {
  readFor(sessionId: string): PlatformContinuedFrom | null;
  save(sessionId: string, seed: PlatformContinuedFrom): void;
  takeUnsent(sessionId: string): PlatformContinuedFrom | null;
  markUnsent(sessionId: string): void;
  copy(fromSessionId: string, toSessionId: string, sent: boolean): void;
  forgetSession(sessionId: string): void;
}

function withinCap(
  sessions: Record<string, SessionEntry>,
  keep: string,
): Record<string, SessionEntry> {
  if (JSON.stringify(sessions).length <= BYTES_CAP) return sessions;
  const stale = Object.entries(sessions)
    .filter(([sessionId]) => sessionId !== keep)
    .sort(([, a], [, b]) => a.savedAt.localeCompare(b.savedAt));
  const next = { ...sessions };
  for (const [sessionId] of stale) {
    delete next[sessionId];
    if (JSON.stringify(next).length <= BYTES_CAP) break;
  }
  return next;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Keeps the copy a follow-up chat starts from — the
 * prompt and the result of a finished sub-agent — so every load of that chat
 * can draw it above the conversation, and the harness gets it once, with the
 * chat's first prompt. A session-history provider rebuilds the log from the
 * harness's own store, which holds the copy only inside that first prompt, so
 * the copy has its own document (`.platform/continued-from.json`): a result
 * can be large, and this document is written only when a follow-up chat
 * starts, when its first prompt goes out, and when it is rewound, forked or
 * deleted. `sent` turns true when the copy is
 * framed into a prompt, and back to false when that prompt is dropped or
 * recorded undelivered, which never keeps the copy, so the next prompt carries
 * it again. The document is
 * byte-capped: whole sessions evict, oldest first, never the one being
 * written.
 */
export function createContinuedFromStore(
  backend: DocumentStoreBackend,
  now: () => string,
): ContinuedFromStore {
  const store = backend.open("continued-from", {
    schema: stateSchema,
    initial: () => ({ sessions: {} }),
  });

  function write(sessions: Record<string, SessionEntry>, keep: string): void {
    store.write({ sessions: withinCap(sessions, keep) });
  }

  return {
    readFor(sessionId) {
      return store.read().sessions[sessionId]?.seed ?? null;
    },

    save(sessionId, seed) {
      const { sessions } = store.read();
      write(
        { ...sessions, [sessionId]: { seed, sent: false, savedAt: now() } },
        sessionId,
      );
    },

    takeUnsent(sessionId) {
      const { sessions } = store.read();
      const entry = sessions[sessionId];
      if (entry === undefined || entry.sent) return null;
      write({ ...sessions, [sessionId]: { ...entry, sent: true } }, sessionId);
      return entry.seed;
    },

    markUnsent(sessionId) {
      const { sessions } = store.read();
      const entry = sessions[sessionId];
      if (entry === undefined || !entry.sent) return;
      write({ ...sessions, [sessionId]: { ...entry, sent: false } }, sessionId);
    },

    copy(fromSessionId, toSessionId, sent) {
      const { sessions } = store.read();
      const entry = sessions[fromSessionId];
      if (entry === undefined) return;
      write(
        { ...sessions, [toSessionId]: { ...entry, sent, savedAt: now() } },
        toSessionId,
      );
    },

    forgetSession(sessionId) {
      const { sessions } = store.read();
      if (sessions[sessionId] === undefined) return;
      const next = { ...sessions };
      delete next[sessionId];
      store.write({ sessions: next });
    },
  };
}
