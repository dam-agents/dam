import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";

interface PendingEvent {
  id: string;
  kind: string;
  payload: unknown;
}

const isInvocationTask = (event: PendingEvent): boolean =>
  event.kind === "invocation-script" ||
  (event.kind === "trigger" &&
    (event.payload as Record<string, unknown> | null)?.invocation === true);

/**
 * UNIT_BOUNDARY_DESCRIPTION: a one-off sub-agent does not start its work while
 * a network rule its driver set at launch waits for the owner. Its task is
 * left out of a delivery for as long as one such rule waits, so the work never
 * runs without the access it was launched for, and the owner's answer is not
 * raced by a run that ends in seconds. The start is not stamped meanwhile, so
 * the run keeps its whole time limit for the work, and a wait nobody answers
 * ends at the spawn's own deadline with the reason. A kept sub-agent is not
 * held: its work goes on over many runs, and a request a waiting rule would
 * allow is held at the egress gate instead. Any other event passes.
 */
export function createInvocationEgressHold(deps: {
  repo: Pick<InvocationsRepository, "find">;
  waitingRules: (agentId: string) => Promise<readonly unknown[]>;
}): <E extends PendingEvent>(agentId: string, event: E) => Promise<E | null> {
  return async (agentId, event) => {
    if (!isInvocationTask(event)) return event;
    const row = await deps.repo.find(agentId);
    if (!row || row.keepUntil !== null) return event;
    return (await deps.waitingRules(agentId)).length > 0 ? null : event;
  };
}
