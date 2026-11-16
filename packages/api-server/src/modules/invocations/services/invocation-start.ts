import { scriptDeadline } from "../domain/script-output.js";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";

interface PendingEvent {
  id: string;
  kind: string;
  payload: unknown;
}

const isInvocationTurn = (event: PendingEvent): boolean =>
  event.kind === "trigger" &&
  (event.payload as Record<string, unknown> | null)?.invocation === true;

/**
 * UNIT_BOUNDARY_DESCRIPTION: a sub-agent's deadline runs from the first
 * delivery of its task to its runtime, not from its spawn, so a start that
 * waits for room in its owner's memory keeps its whole time limit for the
 * work. Delivery goes only to a Ready Agent whose runtime said hello, so the
 * first delivery of the task (its `invocation` trigger, or its
 * `invocation-script` event) stamps the start and moves the deadline to the
 * start plus the time limit. A script's task carries its own stop and report
 * times, which are set from that start on each delivery; a redelivery finds
 * the stamp and keeps it, so a retry sends the same times. Any other event,
 * and a task whose stamp cannot be written pass as stored, so a failed write
 * never drops the task. A task that is not its Invocation's running run (an
 * earlier run of a kept or clean slate target, or one whose Invocation ended)
 * is dropped, so the machine never starts work nobody awaits.
 */
export function createInvocationStart(deps: {
  repo: Pick<InvocationsRepository, "markStarted">;
  log: (msg: string) => void;
  now?: () => Date;
}): <E extends PendingEvent>(agentId: string, event: E) => Promise<E | null> {
  const now = deps.now ?? (() => new Date());
  return async (agentId, event) => {
    const script = event.kind === "invocation-script";
    if (!script && !isInvocationTurn(event)) return event;
    let start;
    try {
      start = await deps.repo.markStarted(agentId, event.id, now());
    } catch (err) {
      deps.log(
        `[invocation-start] ${agentId}: start not stamped, the task goes as queued: ${(err as Error).message}`,
      );
      return event;
    }
    if (!start) return null;
    if (!script) return event;
    return {
      ...event,
      payload: {
        ...(event.payload as Record<string, unknown>),
        deadline: scriptDeadline(
          start.startedAt,
          start.expiresAt,
        ).toISOString(),
        reportBy: start.expiresAt.toISOString(),
      },
    };
  };
}
