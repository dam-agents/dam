import {
  platformRunResultSchema,
  type PlatformRunResult,
} from "api-server-api";
import { z } from "zod";

import type { DocumentStoreBackend } from "../../../core/document-store.js";

const BYTES_CAP = 16 * 1024 * 1024;

const stateSchema = z
  .object({
    sessions: z.record(z.string(), z.unknown()).default({}),
  })
  .transform(({ sessions }) => {
    const valid: Record<string, PlatformRunResult> = {};
    for (const [sessionId, entry] of Object.entries(sessions)) {
      const parsed = platformRunResultSchema.safeParse(entry);
      if (parsed.success) valid[sessionId] = parsed.data;
    }
    return { sessions: valid };
  });

export interface RunResultStore {
  readFor(sessionId: string): PlatformRunResult | null;
  record(sessionId: string, result: PlatformRunResult): void;
  forgetSession(sessionId: string): void;
}

function withinCap(
  sessions: Record<string, PlatformRunResult>,
  keep: string,
): Record<string, PlatformRunResult> {
  if (JSON.stringify(sessions).length <= BYTES_CAP) return sessions;
  const stale = Object.entries(sessions)
    .filter(([sessionId]) => sessionId !== keep)
    .sort(([, a], [, b]) => a.endedAt.localeCompare(b.endedAt));
  const next = { ...sessions };
  for (const [sessionId] of stale) {
    delete next[sessionId];
    if (JSON.stringify(next).length <= BYTES_CAP) break;
  }
  return next;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Keeps the outcome of the newest finished turn of
 * each `cli_run` Session — its stopReason and accumulated assistant text — so
 * a headless caller (`dam run get`) can read a run's result after the Session
 * Transcript is gone. The Transcript is in-memory and the idle reap forgets it
 * seconds after a turn ends with no client attached, so a record written at
 * turn end in its own document (`.platform/run-results.json`) is the only
 * uniform place a detached run's answer survives, across every harness. One
 * record per Session, newest turn wins; it goes when the Session is deleted,
 * or — the document is byte-capped — when another session's write needs the
 * room: oldest records evict first, never the one being written. The record
 * lives on this pod's disk, so it survives restarts as long as the pod's home
 * does, and no longer.
 */
export function createRunResultStore(
  backend: DocumentStoreBackend,
): RunResultStore {
  const store = backend.open("run-results", {
    schema: stateSchema,
    initial: () => ({ sessions: {} }),
  });

  return {
    readFor(sessionId) {
      return store.read().sessions[sessionId] ?? null;
    },

    record(sessionId, result) {
      const { sessions } = store.read();
      store.write({
        sessions: withinCap({ ...sessions, [sessionId]: result }, sessionId),
      });
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
