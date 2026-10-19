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
  harnessExited(): void;
  modelAnswered(sessionId: string | null): void;
  modelError(
    sessionId: string | null,
    error: { status: number; text: string; permanent: boolean },
  ): void;
}

export interface InvocationWatchDeps {
  reporter: { report(input: EventReportInput): Promise<void> };
  holdsWork: (sessionId: string) => boolean;
  stallMs?: number;
  log: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A sub-agent's pod runs one turn, and only a
 * reported result ends its Invocation; a turn that stops without one would
 * otherwise hold the Invocation as running until its deadline. The watch
 * follows that one turn and reports its trigger event as failed, with the
 * cause, as soon as the sub-agent can no longer produce a result: its turn
 * ended or failed, its harness exited, or a model call the provider refused
 * outright was answered by no successful call within stallMs — Codex,
 * refused its first call, goes quiet without ending the turn. A turn that
 * leaves background work or sub-agents of its own behind may still go on to
 * report, so its clean end is left to the deadline. The api-server fails only a running
 * Invocation, so a turn that did report its result is never failed.
 */
export function createInvocationWatch(
  deps: InvocationWatchDeps,
): InvocationWatch {
  const stallMs = deps.stallMs ?? DEFAULT_STALL_MS;
  let watched: {
    sessionId: string;
    eventId: string;
    lastError: string | null;
    stall: ReturnType<typeof setTimeout> | null;
  } | null = null;

  function clearStall(): void {
    if (watched?.stall) clearTimeout(watched.stall);
    if (watched) watched.stall = null;
  }

  function fail(cause: string): void {
    if (!watched) return;
    clearStall();
    const { eventId, lastError } = watched;
    watched = null;
    const detail = (
      lastError ? `${cause}; its last model call failed: ${lastError}` : cause
    ).slice(0, DETAIL_MAX);
    deps.log(`[invocation] failing the run: ${detail}`);
    deps.reporter
      .report({ eventId, outcome: "failed", stage: "run", detail })
      .catch((err: unknown) =>
        deps.log(
          `[invocation] run failure report failed: ${(err as Error).message}`,
        ),
      );
  }

  const isWatched = (sessionId: string | null): boolean =>
    sessionId !== null && watched?.sessionId === sessionId;

  return {
    watch(sessionId, eventId) {
      clearStall();
      watched = { sessionId, eventId, lastError: null, stall: null };
    },

    turnEnded(sessionId, { stopReason, error }) {
      if (!isWatched(sessionId)) return;
      if (error !== null) {
        fail(`the sub-agent's turn failed: ${error}`);
        return;
      }
      if (deps.holdsWork(sessionId)) {
        deps.log(
          `[invocation] turn ended with work still running; leaving the run to its deadline`,
        );
        clearStall();
        watched = null;
        return;
      }
      fail(
        `the sub-agent's turn ended without a reported result (stop reason: ${stopReason ?? "end_turn"})`,
      );
    },

    harnessExited() {
      fail("the sub-agent's harness exited before it reported a result");
    },

    modelAnswered(sessionId) {
      if (!isWatched(sessionId) || !watched) return;
      clearStall();
      watched.lastError = null;
    },

    modelError(sessionId, { status, text, permanent }) {
      if (!isWatched(sessionId) || !watched) return;
      watched.lastError = `${status} ${text.replace(/\s+/g, " ").trim()}`.slice(
        0,
        MODEL_ERROR_MAX,
      );
      if (!permanent || watched.stall) return;
      const stall = setTimeout(
        () => fail("the sub-agent stopped after a refused model call"),
        stallMs,
      );
      stall.unref?.();
      watched.stall = stall;
    },
  };
}
