import type { EventReportInput } from "agent-runtime-api";
import { safeReport } from "../infrastructure/report.js";

const DETAIL_MAX = 2_000;
const MODEL_ERROR_MAX = 600;
const DEFAULT_STALL_MS = 60_000;
const DEFAULT_RETRIABLE_STALL_MS = 5 * 60_000;
const DEFAULT_RECHECK_MS = 60_000;
const DEFAULT_CONFIRM_MS = 30_000;

export interface InvocationWatch {
  watch(sessionId: string, eventId: string): void;
  resultAccepted(sessionId: string): void;
  ended(sessionId: string): void;
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
  retriableStallMs?: number;
  recheckMs?: number;
  confirmMs?: number;
  log: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A sub-agent's run ends only with an accepted
 * report_result; a run that stops without one would hold its Invocation as
 * running until its deadline. The watch follows each run's session, several
 * at once in a kept sub-agent, and reports that run's trigger event as failed,
 * with the cause and the session, once the run can no longer produce a
 * result. A turn that fails, or a harness that exits under it, fails the run
 * at once. Two causes need a decision first: a turn that ended without a
 * result, and a model call that failed with no completed call after it, for
 * stallMs when the provider refused it outright and retriableStallMs when a
 * retry could succeed — Codex, refused its first call, goes quiet without
 * ending the turn. Both go through one decision, which fails the run only
 * when nothing can still report: no model or tool call, no background work,
 * no sub-agent of its own still running, and, for an ended turn, no turn
 * running (a failed call fails the run under an open turn, since the harness
 * has gone quiet inside it), and only when it finds that twice, confirmMs
 * apart: a sub-agent's result, or a harness's own next turn, reaches the
 * session a few seconds after the work behind it ends. The local state is
 * read again after the sub-agent probe, the one await, and a decision that
 * finds work running is taken again every recheckMs, so work that ends
 * without a further turn fails the run then, not at the deadline. An accepted
 * result, or a run the platform ended, stands its watch down. A machine
 * restart needs no watch: the liveness sweep fails a sub-agent whose machine
 * restarted.
 */
export function createInvocationWatch(
  deps: InvocationWatchDeps,
): InvocationWatch {
  const stallMs = deps.stallMs ?? DEFAULT_STALL_MS;
  const retriableStallMs = deps.retriableStallMs ?? DEFAULT_RETRIABLE_STALL_MS;
  const recheckMs = deps.recheckMs ?? DEFAULT_RECHECK_MS;
  const confirmMs = deps.confirmMs ?? DEFAULT_CONFIRM_MS;
  interface WatchedRun {
    sessionId: string;
    eventId: string;
    callsInFlight: number;
    lastError: string | null;
    turnEnded: string | null;
    refused: boolean;
    idleSeen: boolean;
    decision: ReturnType<typeof setTimeout> | null;
  }
  const runs = new Map<string, WatchedRun>();

  function standDown(sessionId: string): void {
    const run = runs.get(sessionId);
    if (run?.decision) clearTimeout(run.decision);
    runs.delete(sessionId);
  }

  function fail(run: WatchedRun, cause: string): void {
    if (runs.get(run.sessionId) !== run) return;
    const { eventId, lastError, sessionId } = run;
    standDown(sessionId);
    const detail = (
      lastError ? `${cause}; its last model call failed: ${lastError}` : cause
    ).slice(0, DETAIL_MAX);
    deps.log(`[invocation] failing the run: ${detail}`);
    void safeReport(
      () =>
        deps.reporter.report({
          eventId,
          outcome: "failed",
          stage: "run",
          detail,
          sessionId,
        }),
      deps.log,
      "[invocation] run failure report",
    );
  }

  const watched = (sessionId: string | null) =>
    sessionId === null ? null : (runs.get(sessionId) ?? null);

  function schedule(run: WatchedRun, delayMs: number): void {
    if (runs.get(run.sessionId) !== run) return;
    if (run.decision) clearTimeout(run.decision);
    const timer = setTimeout(() => {
      if (runs.get(run.sessionId) !== run || run.decision !== timer) return;
      run.decision = null;
      void decide(run);
    }, delayMs);
    timer.unref?.();
    run.decision = timer;
  }

  function causeNow(run: WatchedRun): string | null {
    if (runs.get(run.sessionId) !== run) return null;
    const turnRunning = deps.turnRunning(run.sessionId);
    if (run.turnEnded !== null && !turnRunning) return run.turnEnded;
    if (run.refused) return "the sub-agent stopped after a refused model call";
    return null;
  }

  const workRunning = (run: WatchedRun): boolean =>
    run.callsInFlight > 0 || deps.localWork(run.sessionId);

  async function decide(run: WatchedRun): Promise<void> {
    if (causeNow(run) === null) return;
    if (workRunning(run)) {
      run.idleSeen = false;
      schedule(run, recheckMs);
      return;
    }
    const subAgents = await deps.subAgentsRunning(run.sessionId);
    const cause = causeNow(run);
    if (cause === null) return;
    if (subAgents || workRunning(run)) {
      deps.log(`[invocation] the run still has work running; checking again`);
      run.idleSeen = false;
      schedule(run, recheckMs);
      return;
    }
    if (!run.idleSeen) {
      run.idleSeen = true;
      schedule(run, confirmMs);
      return;
    }
    fail(run, cause);
  }

  return {
    watch(sessionId, eventId) {
      standDown(sessionId);
      runs.set(sessionId, {
        sessionId,
        eventId,
        callsInFlight: 0,
        lastError: null,
        turnEnded: null,
        refused: false,
        idleSeen: false,
        decision: null,
      });
    },

    resultAccepted(sessionId) {
      if (!watched(sessionId)) return;
      deps.log(`[invocation] the run reported its result`);
      standDown(sessionId);
    },

    ended(sessionId) {
      standDown(sessionId);
    },

    turnOutcome(sessionId, { stopReason, error }) {
      const current = watched(sessionId);
      if (!current) return;
      if (error !== null) {
        fail(current, `the sub-agent's turn failed: ${error}`);
        return;
      }
      current.turnEnded = `the sub-agent's turn ended without a reported result (stop reason: ${stopReason ?? "end_turn"})`;
      current.idleSeen = false;
      schedule(current, 0);
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
      if (current.refused) return;
      current.refused = true;
      if (!current.decision)
        schedule(current, permanent ? stallMs : retriableStallMs);
    },
  };
}
