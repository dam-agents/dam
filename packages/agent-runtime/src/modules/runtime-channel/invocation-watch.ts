import type { EventReportInput } from "agent-runtime-api";

const DETAIL_MAX = 2_000;
const MODEL_ERROR_MAX = 600;
const DEFAULT_STALL_MS = 60_000;

export interface InvocationWatch {
  watch(sessionId: string, eventId: string): void;
  turnEnded(
    sessionId: string,
    end: { stopReason: string | null; error: string | null },
  ): void;
  modelCallStarted(sessionId: string | null): void;
  modelCallEnded(sessionId: string | null, answered: boolean): void;
  modelError(
    sessionId: string | null,
    error: { status: number; text: string; permanent: boolean },
  ): void;
}

export interface InvocationWatchDeps {
  reporter: { report(input: EventReportInput): Promise<void> };
  holdsWork: (sessionId: string) => Promise<boolean>;
  toolRunning: (sessionId: string) => boolean;
  stallMs?: number;
  log: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A sub-agent's pod runs one turn, and only a
 * reported result ends its Invocation; a turn that stops without one would
 * otherwise hold the Invocation as running until its deadline. The watch
 * follows that turn and reports its trigger event as failed, with the cause,
 * as soon as the sub-agent can no longer produce a result: its turn failed,
 * its harness exited under it, its turn ended with nothing left running, or
 * a model call the provider refused outright was followed by no completed
 * call within stallMs while no model or tool call ran — Codex, refused its first call,
 * goes quiet without ending the turn. A turn that ends with background work
 * or sub-agents of its own still running may go on in a later turn, so the
 * watch stays on the session. A pod restart needs no watch: the liveness sweep
 * fails a sub-agent whose pod restarted. The api-server fails only a running Invocation, so a run that did
 * report its result is never failed.
 */
export function createInvocationWatch(
  deps: InvocationWatchDeps,
): InvocationWatch {
  const stallMs = deps.stallMs ?? DEFAULT_STALL_MS;
  let run: { sessionId: string; eventId: string } | null = null;
  let lastError: string | null = null;
  let stall: ReturnType<typeof setTimeout> | null = null;
  let callsInFlight = 0;

  function clearStall(): void {
    if (stall) clearTimeout(stall);
    stall = null;
  }

  function fail(cause: string): void {
    if (!run) return;
    const { eventId } = run;
    clearStall();
    run = null;
    const detail = (
      lastError ? `${cause}; its last model call failed: ${lastError}` : cause
    ).slice(0, DETAIL_MAX);
    lastError = null;
    deps.log(`[invocation] failing the run: ${detail}`);
    deps.reporter
      .report({
        eventId,
        outcome: "failed",
        stage: "run",
        detail,
      })
      .catch((err: unknown) =>
        deps.log(
          `[invocation] run failure report failed: ${(err as Error).message}`,
        ),
      );
  }

  const isWatched = (sessionId: string | null): boolean =>
    sessionId !== null && run?.sessionId === sessionId;

  function armStall(sessionId: string): void {
    stall = setTimeout(() => {
      stall = null;
      if (!isWatched(sessionId)) return;
      if (callsInFlight > 0 || deps.toolRunning(sessionId)) {
        armStall(sessionId);
        return;
      }
      fail("the sub-agent stopped after a refused model call");
    }, stallMs);
    stall.unref?.();
  }

  return {
    watch(sessionId, eventId) {
      clearStall();
      lastError = null;
      callsInFlight = 0;
      run = { sessionId, eventId };
    },

    turnEnded(sessionId, { stopReason, error }) {
      if (!isWatched(sessionId)) return;
      if (error !== null) {
        fail(`the sub-agent's turn failed: ${error}`);
        return;
      }
      void deps.holdsWork(sessionId).then((holds) => {
        if (!isWatched(sessionId)) return;
        if (holds) {
          deps.log(
            `[invocation] turn ended with work still running; watching its next turn`,
          );
          return;
        }
        fail(
          `the sub-agent's turn ended without a reported result (stop reason: ${stopReason ?? "end_turn"})`,
        );
      });
    },

    modelCallStarted(sessionId) {
      if (isWatched(sessionId)) callsInFlight++;
    },

    modelCallEnded(sessionId, answered) {
      if (!isWatched(sessionId)) return;
      callsInFlight = Math.max(callsInFlight - 1, 0);
      if (!answered) return;
      clearStall();
      lastError = null;
    },

    modelError(sessionId, { status, text, permanent }) {
      if (sessionId === null || !isWatched(sessionId)) return;
      lastError = `${status} ${text.replace(/\s+/g, " ").trim()}`.slice(
        0,
        MODEL_ERROR_MAX,
      );
      if (permanent && !stall) armStall(sessionId);
    },
  };
}
