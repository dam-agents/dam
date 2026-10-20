const DEFAULT_PRESUME_IDLE_MS = 10 * 60 * 1000;

export interface ToolCallState {
  toolCallId: string;
  started: boolean;
  settled: boolean;
}

export interface HarnessActivity {
  report(sessionId: string, busy: boolean): void;
  noteUpdate(sessionId: string, call: ToolCallState | null): void;
  isBusy(sessionId: string): boolean;
  busySessions(): string[];
  forget(sessionId: string): void;
  clear(): void;
}

export interface HarnessActivityDeps {
  onBusy: (sessionId: string) => void;
  onIdle: (sessionId: string) => void;
  mayPresumeIdle: (sessionId: string) => boolean;
  presumeIdleMs?: number;
  log?: (msg: string) => void;
}

interface BusySession {
  timer: ReturnType<typeof setTimeout> | undefined;
  openCalls: Set<string>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Knows, per session, whether the harness said it
 * is still working outside the prompt it answered — an Autonomous Turn running
 * or queued, such as Claude Code handling the last reports of its background
 * agents. A session is busy from the harness's first busy report to its idle
 * report. A harness that reports nothing is never busy, so its session counts
 * as idle once the prompt is answered. A harness can lose its idle report, so
 * a session that stays silent for the backstop period — no session/update, no
 * open tool call, and nothing that `mayPresumeIdle` refuses, such as reported
 * background work — is treated as idle, with a warning in the log.
 */
export function createHarnessActivity(
  deps: HarnessActivityDeps,
): HarnessActivity {
  const busy = new Map<string, BusySession>();
  const presumeIdleMs = deps.presumeIdleMs ?? DEFAULT_PRESUME_IDLE_MS;

  function arm(sessionId: string, entry: BusySession): void {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => presumeIdle(sessionId), presumeIdleMs);
  }

  function settle(sessionId: string): void {
    const entry = busy.get(sessionId);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    busy.delete(sessionId);
    deps.onIdle(sessionId);
  }

  function presumeIdle(sessionId: string): void {
    const entry = busy.get(sessionId);
    if (entry === undefined) return;
    if (entry.openCalls.size > 0 || !deps.mayPresumeIdle(sessionId)) {
      arm(sessionId, entry);
      return;
    }
    deps.log?.(
      `harness sent no idle report for session ${sessionId} and stayed silent ` +
        `for ${String(Math.round(presumeIdleMs / 1000))}s; treating it as idle`,
    );
    settle(sessionId);
  }

  return {
    report(sessionId, isBusy) {
      if (!isBusy) {
        settle(sessionId);
        return;
      }
      const existing = busy.get(sessionId);
      if (existing !== undefined) {
        arm(sessionId, existing);
        return;
      }
      const entry: BusySession = { timer: undefined, openCalls: new Set() };
      busy.set(sessionId, entry);
      arm(sessionId, entry);
      deps.onBusy(sessionId);
    },

    noteUpdate(sessionId, call) {
      const entry = busy.get(sessionId);
      if (entry === undefined) return;
      arm(sessionId, entry);
      if (call === null) return;
      if (call.settled) entry.openCalls.delete(call.toolCallId);
      else entry.openCalls.add(call.toolCallId);
    },

    isBusy(sessionId) {
      return busy.has(sessionId);
    },

    busySessions() {
      return [...busy.keys()];
    },

    forget(sessionId) {
      const entry = busy.get(sessionId);
      if (entry === undefined) return;
      clearTimeout(entry.timer);
      busy.delete(sessionId);
    },

    clear() {
      for (const entry of busy.values()) clearTimeout(entry.timer);
      busy.clear();
    },
  };
}
