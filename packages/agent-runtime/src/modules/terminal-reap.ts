export type TerminalReap =
  | { kind: "kill" }
  | { kind: "wait"; ms: number };

/**
 * UNIT_BOUNDARY_DESCRIPTION: Decides when a detached PTY is killed. A PTY that
 * printed nothing for PTY_IDLE_REAP_MS is abandoned and killed, as before. A
 * terminal session that reports background work is never killed, because
 * killing the PTY sends the harness SIGHUP and the harness kills its Harness
 * Tasks with it. Background tasks print to their own output file, not to the
 * screen, so a quiet screen says nothing about them. This is the same hold a
 * chat session gets: while the work runs the reaper checks again every
 * recheckMs, and the quiet clock applies again once the report is empty.
 */
export function terminalReap(input: {
  quietMs: number;
  idleReapMs: number;
  holdsBackgroundWork: boolean;
  recheckMs: number;
}): TerminalReap {
  if (input.holdsBackgroundWork) return { kind: "wait", ms: input.recheckMs };
  if (input.quietMs >= input.idleReapMs) return { kind: "kill" };
  return { kind: "wait", ms: input.idleReapMs - input.quietMs };
}
