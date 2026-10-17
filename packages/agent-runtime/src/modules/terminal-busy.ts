/**
 * UNIT_BOUNDARY_DESCRIPTION: Decides whether one PTY makes the runtime busy.
 * An attached PTY does, and so does a detached one the idle reap would not kill
 * yet: inside the detach grace, or quiet for less than the idle window. A PTY
 * the reap keeps open only for its background work is busy only while that work
 * is kept, as a chat session is. So an unkept task holds its terminal open but
 * lets the agent hibernate, and dies then.
 */
export function terminalBusy(input: {
  attached: boolean;
  sinceDetachMs: number;
  quietMs: number;
  detachGraceMs: number;
  idleReapMs: number;
  keptBackgroundWork: boolean;
}): boolean {
  return (
    input.attached ||
    input.sinceDetachMs < input.detachGraceMs ||
    input.quietMs < input.idleReapMs ||
    input.keptBackgroundWork
  );
}
