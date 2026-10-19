import type { EventReportInput } from "agent-runtime-api";

const DETAIL_MAX = 2_000;
const MODEL_ERROR_MAX = 600;
const DEFAULT_STALL_MS = 60_000;
const DEFAULT_RECHECK_MS = 60_000;
const DEFAULT_CONFIRM_MS = 30_000;

export interface InvocationWatch {
  watch(sessionId: string, eventId: string): void;
  resultAccepted(sessionId: string): void;
  turnOutcome(
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
  turnRunning: (sessionId: string) => boolean;
  localWork: (sessionId: string) => boolean;
  subAgentsRunning: (sessionId: string) => Promise<boolean>;
  stallMs?: number;
  recheckMs?: number;
  confirmMs?: number;
  log: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A sub-agent's pod runs one Invocation, and only
 * an accepted report_result ends it; a run that stops without one would hold
 * the Invocation as running until its deadline. The watch follows the run's
 * session and reports its trigger event as failed, with the cause, once the
 * run can no longer produce a result. A turn that fails, or a harness that
 * exits under it, fails the run at once. Two causes need a decision first: a
 * turn that ended without a result, and a model call the provider refused
 * outright with no completed call for stallMs after it — Codex, refused its
 * first call, goes quiet without ending the turn. Both go through one
 * decision, which fails the run only when nothing can still report: no turn
 * running (for an ended turn), no model or tool call, no background work, and
 * no sub-agent of its own still running, and only when it finds that twice,
 * confirmMs apart: a sub-agent's result, or a harness's own next turn, reaches
 * the session a few seconds after the work behind it ends. The local state is
 * read again after the sub-agent probe, the one await, and a decision that
 * finds work running is taken again every recheckMs, so work that ends
 * without a further turn fails the run then, not at the deadline. An accepted result stands the
 * watch down. A pod restart needs no watch: the liveness sweep fails a
 * sub-agent whose pod restarted.
 */
export function createInvocationWatch(
  deps: InvocationWatchDeps,
): InvocationWatch {
  const stallMs = deps.stallMs ?? DEFAULT_STALL_MS;
  const recheckMs = deps.recheckMs ?? DEFAULT_RECHECK_MS;
  const confirmMs = deps.confirmMs ?? DEFAULT_CONFIRM_MS;
  let run: {
    sessionId: string;
    eventId: string;
    callsInFlight: number;
    lastError: string | null;
    turnEnded: string | null;
    refused: boolean;
    idleSeen: boolean;
    decision: ReturnType<typeof setTimeout> | null;
  } | null = null;

  function standDown(): void {
    if (run?.decision) clearTimeout(run.decision);
    run = null;
  }

  function fail(cause: string): void {
    if (!run) return;
    const { eventId, lastError } = run;
    standDown();
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

  const watched = (sessionId: string | null) =>
    sessionId !== null && run?.sessionId === sessionId ? run : null;

  function schedule(delayMs: number): void {
    if (!run) return;
    if (run.decision) clearTimeout(run.decision);
    const current = run;
    const timer = setTimeout(() => {
      if (run !== current || current.decision !== timer) return;
      current.decision = null;
      void decide();
    }, delayMs);
    timer.unref?.();
    current.decision = timer;
  }

  function causeNow(): string | null {
    if (!run) return null;
    const turnRunning = deps.turnRunning(run.sessionId);
    if (run.turnEnded !== null && !turnRunning) return run.turnEnded;
    if (run.refused) return "the sub-agent stopped after a refused model call";
    return null;
  }

  const workRunning = (): boolean =>
    run !== null && (run.callsInFlight > 0 || deps.localWork(run.sessionId));

  async function decide(): Promise<void> {
    const current = run;
    if (!current || causeNow() === null) return;
    if (workRunning()) {
      current.idleSeen = false;
      schedule(recheckMs);
      return;
    }
    const subAgents = await deps.subAgentsRunning(current.sessionId);
    if (run !== current) return;
    const cause = causeNow();
    if (cause === null) return;
    if (subAgents || workRunning()) {
      deps.log(`[invocation] the run still has work running; checking again`);
      current.idleSeen = false;
      schedule(recheckMs);
      return;
    }
    if (!current.idleSeen) {
      current.idleSeen = true;
      schedule(confirmMs);
      return;
    }
    fail(cause);
  }

  return {
    watch(sessionId, eventId) {
      standDown();
      run = {
        sessionId,
        eventId,
        callsInFlight: 0,
        lastError: null,
        turnEnded: null,
        refused: false,
        idleSeen: false,
        decision: null,
      };
    },

    resultAccepted(sessionId) {
      if (!watched(sessionId)) return;
      deps.log(`[invocation] the run reported its result`);
      standDown();
    },

    turnOutcome(sessionId, { stopReason, error }) {
      const current = watched(sessionId);
      if (!current) return;
      if (error !== null) {
        fail(`the sub-agent's turn failed: ${error}`);
        return;
      }
      current.turnEnded = `the sub-agent's turn ended without a reported result (stop reason: ${stopReason ?? "end_turn"})`;
      schedule(0);
    },

    modelCallStarted(sessionId) {
      const current = watched(sessionId);
      if (current) current.callsInFlight++;
    },

    modelCallEnded(sessionId, answered) {
      const current = watched(sessionId);
      if (!current) return;
      current.callsInFlight = Math.max(current.callsInFlight - 1, 0);
      if (!answered) return;
      current.refused = false;
      current.idleSeen = false;
      current.lastError = null;
    },

    modelError(sessionId, { status, text, permanent }) {
      const current = watched(sessionId);
      if (!current) return;
      current.lastError = `${status} ${text.replace(/\s+/g, " ").trim()}`.slice(
        0,
        MODEL_ERROR_MAX,
      );
      if (!permanent || current.refused) return;
      current.refused = true;
      if (!current.decision) schedule(stallMs);
    },
  };
}
