import {
  platformUndeliveredPromptSchema,
  type PlatformUndeliveredPrompt,
} from "api-server-api";
import { z } from "zod";

import type { DocumentStoreBackend } from "../../../core/document-store.js";

const BYTES_CAP = 16 * 1024 * 1024;

const sessionEntrySchema = z.object({
  prompts: z.array(platformUndeliveredPromptSchema).min(1),
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

export interface UndeliveredPromptStore {
  readFor(sessionId: string): PlatformUndeliveredPrompt[];
  remember(sessionId: string, prompts: PlatformUndeliveredPrompt[]): void;
  forget(sessionId: string, id: string): boolean;
  forgetSession(sessionId: string): void;
}

function earliest(entry: SessionEntry): string {
  return entry.prompts.reduce(
    (min, p) => (p.recordedAt < min ? p.recordedAt : min),
    entry.prompts[0]?.recordedAt ?? "",
  );
}

function bytesOf(sessions: Record<string, SessionEntry>): number {
  return JSON.stringify(sessions).length;
}

function withinCap(
  sessions: Record<string, SessionEntry>,
  keep: string,
): Record<string, SessionEntry> {
  if (bytesOf(sessions) <= BYTES_CAP) return sessions;
  const stale = Object.entries(sessions)
    .filter(([sessionId]) => sessionId !== keep)
    .sort(([, a], [, b]) => earliest(a).localeCompare(earliest(b)));
  const next = { ...sessions };
  for (const [sessionId] of stale) {
    delete next[sessionId];
    if (bytesOf(next) <= BYTES_CAP) break;
  }
  return next;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Keeps the text of prompts that never reached the
 * harness — a queue the Prompt Scheduler dropped, or a send a client could not
 * deliver — so a returning client can send them again. It owns its own
 * document (`.platform/undelivered-prompts.json`) rather than sharing the session
 * metadata one on purpose: that document is rewritten in full on every prompt,
 * so message text living there would be re-serialized on every turn, and a
 * malformed write would reset read state and user text together. Here the
 * document is written only when a prompt is recorded, sent again, or deleted,
 * so holding a prompt's whole content — pasted image bytes included — costs a
 * rare write on this pod's own disk rather than anything per turn.
 * A record outlives session teardown and pod restarts, and goes when the user
 * acts on it, when the Session is deleted, or — the document is byte-capped —
 * when another session's write needs the room: whole sessions evict, oldest
 * first, never the one being written. Each prompt carries when it was
 * recorded, so a client can interleave these with the ones it held locally
 * while it could not reach the pod, and its attachments by name, because the
 * files themselves are not kept anywhere this outlives.
 */
export function createUndeliveredPromptStore(
  backend: DocumentStoreBackend,
  now: () => string,
): UndeliveredPromptStore {
  const store = backend.open("undelivered-prompts", {
    schema: stateSchema,
    initial: () => ({ sessions: {} }),
  });

  function write(sessions: Record<string, SessionEntry>): void {
    store.write({ sessions });
  }

  return {
    readFor(sessionId) {
      return store.read().sessions[sessionId]?.prompts ?? [];
    },

    remember(sessionId, prompts) {
      if (prompts.length === 0) return;
      const { sessions } = store.read();
      const existing = sessions[sessionId]?.prompts ?? [];
      const fresh = prompts.filter((p) => !existing.some((e) => e.id === p.id));
      if (fresh.length === 0) return;
      const stamped = fresh.map((p) => ({
        ...p,
        recordedAt: p.recordedAt || now(),
      }));
      write(
        withinCap(
          {
            ...sessions,
            [sessionId]: { prompts: [...existing, ...stamped] },
          },
          sessionId,
        ),
      );
    },

    forget(sessionId, id) {
      const { sessions } = store.read();
      const existing = sessions[sessionId];
      if (existing === undefined) return false;
      const kept = existing.prompts.filter((p) => p.id !== id);
      if (kept.length === existing.prompts.length) return false;
      const next = { ...sessions };
      if (kept.length === 0) delete next[sessionId];
      else next[sessionId] = { prompts: kept };
      write(next);
      return true;
    },

    forgetSession(sessionId) {
      const { sessions } = store.read();
      if (sessions[sessionId] === undefined) return;
      const next = { ...sessions };
      delete next[sessionId];
      write(next);
    },
  };
}
