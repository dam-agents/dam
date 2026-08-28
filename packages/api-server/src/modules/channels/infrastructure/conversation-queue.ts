import {
  planCoalescedDelivery,
  settleRoundsRemaining,
} from "../domain/turn-coalescing.js";

export interface ConversationQueue<T> {
  submit(message: T): Promise<void>;
}

export interface ConversationQueueDeps<T> {
  settleMs: number;
  canSteer?: (message: T) => boolean;
  runTurn: (
    batch: T[],
    onSession: (sessionId: string) => void,
  ) => Promise<void>;
  steer: (sessionId: string, batch: T[]) => Promise<boolean>;
  onSteered?: (batch: T[], turnStillRunning: boolean) => void;
  onTurnSettled?: (batch: T[]) => void;
  onEmpty?: () => void;
  onError?: (err: unknown) => void;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** UNIT_BOUNDARY_DESCRIPTION: Runs one conversation's messages as as few turns
 *  as possible, and is shared so Slack and Telegram behave the same way. It
 *  holds arriving messages for a short quiet period so a burst becomes one
 *  turn, then runs that turn. A message that lands while the turn is running is
 *  steered into it — the agent reads it before it calls its reply tool, so the
 *  conversation still gets one answer — and where the harness refuses steering
 *  the message waits and becomes the next turn instead of a second one racing
 *  the first. The caller supplies what a turn and a steer mean on its surface;
 *  the ordering, the quiet period, and the one-turn-at-a-time rule live here. */
export function createConversationQueue<T>(
  deps: ConversationQueueDeps<T>,
): ConversationQueue<T> {
  let pending: T[] = [];
  let draining = false;
  let sessionId: string | null = null;
  let turnEpoch = 0;

  async function settle(): Promise<void> {
    if (deps.settleMs <= 0) return;
    let rounds = 0;
    let seen = -1;
    while (
      seen !== pending.length &&
      settleRoundsRemaining(rounds, pending.length)
    ) {
      seen = pending.length;
      rounds += 1;
      await delay(deps.settleMs);
    }
  }

  async function steerPending(): Promise<void> {
    const target = sessionId;
    if (target === null) return;
    const epoch = turnEpoch;
    const plan = planCoalescedDelivery({
      pending,
      turnInFlight: true,
      steerable: true,
      ...(deps.canSteer ? { canSteer: deps.canSteer } : {}),
    });
    if (plan.kind !== "steer") return;

    const injected = await deps.steer(target, plan.batch);
    if (!injected) return;

    const steered = new Set(plan.batch);
    pending = pending.filter((message) => !steered.has(message));
    deps.onSteered?.(plan.batch, turnEpoch === epoch);
  }

  async function drain(): Promise<void> {
    draining = true;
    try {
      await settle();
      while (pending.length > 0) {
        const plan = planCoalescedDelivery({
          pending,
          turnInFlight: false,
          steerable: false,
        });
        if (plan.kind !== "start") break;
        pending = plan.remaining;
        const batch = plan.batch;
        try {
          await deps.runTurn(batch, (id) => {
            sessionId = id;
          });
        } finally {
          sessionId = null;
          turnEpoch += 1;
          deps.onTurnSettled?.(batch);
        }
      }
    } catch (err) {
      deps.onError?.(err);
    } finally {
      draining = false;
      if (pending.length === 0) deps.onEmpty?.();
      else void drain();
    }
  }

  return {
    submit(message: T): Promise<void> {
      pending.push(message);
      return draining ? steerPending() : drain();
    },
  };
}
