export const DEFAULT_MAX_COALESCED_BATCH = 20;

export const DEFAULT_SETTLE_MS = 400;

export const SETTLE_ROUNDS_CAP = 6;

export function settleRoundsRemaining(
  roundsTaken: number,
  batchSize: number,
  maxBatch: number = DEFAULT_MAX_COALESCED_BATCH,
): boolean {
  return roundsTaken < SETTLE_ROUNDS_CAP && batchSize < maxBatch;
}

export type CoalescedDelivery<T> =
  | { kind: "start"; batch: T[]; remaining: T[] }
  | { kind: "steer"; batch: T[]; remaining: T[] }
  | { kind: "hold" };

export interface CoalescingState<T> {
  pending: readonly T[];
  turnInFlight: boolean;
  steerable: boolean;
  canSteer?: (item: T) => boolean;
  maxBatch?: number;
}

function leadingSteerable<T>(
  pending: readonly T[],
  canSteer: (item: T) => boolean,
  cap: number,
): T[] {
  const run: T[] = [];
  for (const item of pending) {
    if (run.length >= cap || !canSteer(item)) break;
    run.push(item);
  }
  return run;
}

/** UNIT_BOUNDARY_DESCRIPTION: Decides what a conversation's queued messages do
 *  next, so both channel workers coalesce the same way. A conversation runs one
 *  turn at a time. With no turn running, the queue starts one carrying every
 *  message waiting — this is what turns a burst into a single answer instead of
 *  one per message. With a turn already running, the messages go into that turn
 *  when the harness accepts steering, so the agent reads them before it calls
 *  its reply tool; where it does not, they wait and become the next turn. A
 *  batch is capped so one turn cannot carry an unbounded prompt, and whatever
 *  the cap leaves over stays queued for the turn after. Only a leading run of
 *  messages may join a running turn: a message the caller cannot steer — one
 *  carrying attachments, which reach the agent through the turn's own delivery
 *  path — stops the run, so the queue never reorders what people sent. */
export function planCoalescedDelivery<T>(
  state: CoalescingState<T>,
): CoalescedDelivery<T> {
  if (state.pending.length === 0) return { kind: "hold" };
  if (state.turnInFlight && !state.steerable) return { kind: "hold" };

  const cap = Math.max(1, state.maxBatch ?? DEFAULT_MAX_COALESCED_BATCH);

  if (state.turnInFlight) {
    const batch = leadingSteerable(
      state.pending,
      state.canSteer ?? (() => true),
      cap,
    );
    if (batch.length === 0) return { kind: "hold" };
    return {
      kind: "steer",
      batch,
      remaining: state.pending.slice(batch.length),
    };
  }

  return {
    kind: "start",
    batch: state.pending.slice(0, cap),
    remaining: state.pending.slice(cap),
  };
}
