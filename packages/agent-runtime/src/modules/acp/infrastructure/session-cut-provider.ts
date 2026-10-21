import { createWorkerCall } from "./worker-call.js";

export type SessionCutOutcome =
  { ok: true } | { ok: false; refused: boolean; message: string };

export interface SessionCutProvider {
  cut(input: {
    sessionId: string;
    before: string;
    dropsTurn?: string;
  }): Promise<SessionCutOutcome>;
}

const DEFAULT_CUT_EXPORT_NAME = "cutSession";

const CUT_TIMEOUT_MS = 60_000;

function outcomeOf(result: unknown): SessionCutOutcome | null {
  if (typeof result !== "object" || result === null) return null;
  const r = result as { ok?: unknown; refused?: unknown; message?: unknown };
  if (r.ok === true) return { ok: true };
  if (r.ok !== false || typeof r.message !== "string") return null;
  return { ok: false, refused: r.refused === true, message: r.message };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Hosts the harness image's declared session-cut
 * module (runtime-manifest `sessionCut.module`) in its own worker thread. Its
 * export cuts a closed session's stored conversation in place: the session
 * keeps everything before the user entry `before` and goes on from there under
 * the same id. `dropsTurn` names the one turn the cut may drop; the module
 * refuses, changing nothing, when anything else would go. A refusal comes back
 * as `refused`; a throw, a crash, a timeout or a malformed answer comes back
 * as not refused, since the store may or may not have been cut.
 */
export function createWorkerSessionCutProvider(deps: {
  modulePath: string;
  exportName?: string;
  timeoutMs?: number;
  log: (msg: string) => void;
}): SessionCutProvider {
  const worker = createWorkerCall({
    modulePath: deps.modulePath,
    exportName: deps.exportName ?? DEFAULT_CUT_EXPORT_NAME,
    label: "session-cut provider",
    log: deps.log,
  });
  const timeoutMs = deps.timeoutMs ?? CUT_TIMEOUT_MS;
  return {
    async cut(input) {
      const called = await worker.call(input, timeoutMs);
      const outcome = called.ok
        ? (outcomeOf(called.result) ?? {
            ok: false as const,
            refused: false,
            message: "the session-cut module gave no outcome",
          })
        : { ok: false as const, refused: false, message: called.error };
      if (!outcome.ok) {
        deps.log(
          `session cut of ${input.sessionId}: ${outcome.refused ? "refused" : "failed"}: ${outcome.message}`,
        );
      }
      return outcome;
    },
  };
}
