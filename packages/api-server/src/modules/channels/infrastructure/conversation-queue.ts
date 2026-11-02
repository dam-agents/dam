import { randomUUID } from "node:crypto";
import { match } from "ts-pattern";
import {
  planCoalescedDelivery,
  settleRoundsRemaining,
} from "../domain/turn-coalescing.js";
import type { AcpClient, SteerOpts } from "../../../core/acp-client.js";
import { getLogger } from "../../../core/logger.js";

export type SteerResult = "injected" | "refused" | "unsupported" | "failed";

const STEER_GRACE_MS = 15_000;

export function getOrCreateQueue<T>(
  queues: Map<string, ConversationQueue<T>>,
  key: string,
  create: () => ConversationQueue<T>,
): ConversationQueue<T> {
  let queue = queues.get(key);
  if (!queue) {
    queue = create();
    queues.set(key, queue);
  }
  return queue;
}

export async function steerChannelTurn(
  acp: Pick<AcpClient, "steer">,
  sessionId: string,
  frame: string,
  request: SteerOpts,
  log: { surface: string; fields: Record<string, unknown> },
): Promise<SteerResult> {
  const outcome = await acp.steer(sessionId, frame, request);
  if (outcome === "injected") return "injected";
  getLogger().debug(
    { ...log.fields, outcome },
    `${log.surface}.turn.steer_declined`,
  );
  return match(outcome)
    .with("unsupported", (): SteerResult => "unsupported")
    .with("failed", (): SteerResult => "failed")
    .with("no-running-turn", (): SteerResult => "refused")
    .exhaustive((): SteerResult => "failed");
}

export interface ConversationQueue<T> {
  submit(message: T): Promise<void>;
  heldSteer(): readonly T[];
  abortSteer(): void;
}

export interface ConversationQueueDeps<T> {
  settleMs: number;
  steerGraceMs?: number;
  canSteer?: (message: T) => boolean;
  runTurn: (
    batch: T[],
    onSession: (sessionId: string, promptId?: string) => void,
    steersSettled: () => Promise<void>,
  ) => Promise<void>;
  steer: (
    sessionId: string,
    batch: T[],
    request: Required<SteerOpts>,
  ) => Promise<SteerResult>;
  onSteered?: (batch: T[]) => void;
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
 *  the first. A steer names the turn it may join by the prompt id of that
 *  turn's prompt, and the agent-runtime holds it until the agent's next steer
 *  point, which can take as long as a command runs, so it has no deadline. A
 *  steer claims its batch out of the queue before it goes out, and puts it
 *  back at the head only when the runtime declines it: once injected, the
 *  message is in a turn, even one that has ended since, so it is never run
 *  again. A steer whose connection fails before its answer is sent once more
 *  under the same id, which the runtime answers with its first answer, so a
 *  lost answer cannot turn into a second delivery. A turn asks for its steers
 *  to settle before it judges its delivery, and a steer still held a grace
 *  time after the turn ended is cut and asked again. One steer runs at a time
 *  and picks up whatever arrived during its round trip, and no turn is
 *  composed while a batch is still claimed — otherwise a batch coming back
 *  would land behind messages sent after it, and the agent would read a split
 *  thought out of order. The caller supplies what a turn and a steer mean on
 *  its surface, and can see and abort a held steer; the ordering, the quiet
 *  period, and the one-turn-at-a-time rule live here. */
export function createConversationQueue<T>(
  deps: ConversationQueueDeps<T>,
): ConversationQueue<T> {
  let pending: T[] = [];
  let draining = false;
  let sessionId: string | null = null;
  let targetPromptId: string | null = null;
  let steerCycle: Promise<void> | null = null;
  let steeringUnsupported = false;
  let held: { batch: T[]; abort: AbortController; withdrawn: boolean } | null =
    null;

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

  async function steerOnce(
    target: string,
    request: Omit<Required<SteerOpts>, "signal">,
    batch: T[],
    signal: AbortSignal,
  ): Promise<SteerResult> {
    try {
      return await deps.steer(target, batch, { ...request, signal });
    } catch (err) {
      deps.onError?.(err);
      return "failed";
    }
  }

  async function steerBatch(
    target: string,
    request: Omit<Required<SteerOpts>, "signal">,
    batch: T[],
  ): Promise<SteerResult> {
    const steer = { batch, abort: new AbortController(), withdrawn: false };
    held = steer;
    try {
      const first = await steerOnce(target, request, batch, steer.abort.signal);
      if (first !== "failed" || steer.withdrawn) return first;
      steer.abort = new AbortController();
      return await steerOnce(target, request, batch, steer.abort.signal);
    } finally {
      held = null;
    }
  }

  async function runSteerCycle(): Promise<void> {
    while (!steeringUnsupported) {
      const target = sessionId;
      const turnPromptId = targetPromptId;
      if (target === null || turnPromptId === null) return;

      const plan = planCoalescedDelivery({
        pending,
        turnInFlight: true,
        steerable: true,
        ...(deps.canSteer ? { canSteer: deps.canSteer } : {}),
      });
      if (plan.kind !== "steer") return;

      const batch = plan.batch;
      pending = plan.remaining;

      const result = await steerBatch(
        target,
        { promptId: randomUUID(), targetPromptId: turnPromptId },
        batch,
      );

      if (result === "unsupported") steeringUnsupported = true;

      if (result !== "injected") {
        pending = [...batch, ...pending];
        return;
      }

      deps.onSteered?.(batch);
    }
  }

  function steersSettled(): Promise<void> {
    const cycle = steerCycle;
    if (cycle === null) return Promise.resolve();
    const grace = setTimeout(
      () => held?.abort.abort(),
      deps.steerGraceMs ?? STEER_GRACE_MS,
    );
    return cycle.finally(() => clearTimeout(grace));
  }

  function steerPending(): Promise<void> {
    if (steerCycle) return steerCycle;
    const cycle = runSteerCycle().finally(() => {
      steerCycle = null;
      if (!draining && pending.length > 0) void drain();
    });
    steerCycle = cycle;
    return cycle;
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      await settle();
      while (pending.length > 0) {
        if (steerCycle) await steerCycle;
        const plan = planCoalescedDelivery({
          pending,
          turnInFlight: false,
          steerable: false,
        });
        if (plan.kind !== "start") break;
        pending = plan.remaining;
        const batch = plan.batch;
        try {
          await deps.runTurn(
            batch,
            (id, promptId) => {
              sessionId = id;
              targetPromptId = promptId ?? null;
            },
            steersSettled,
          );
        } finally {
          sessionId = null;
          targetPromptId = null;
          deps.onTurnSettled?.(batch);
        }
      }
    } catch (err) {
      deps.onError?.(err);
    } finally {
      draining = false;
      if (pending.length > 0) void drain();
      else if (steerCycle === null) deps.onEmpty?.();
    }
  }

  return {
    submit(message: T): Promise<void> {
      pending.push(message);
      return draining ? steerPending() : drain();
    },

    heldSteer() {
      return held?.batch ?? [];
    },

    abortSteer() {
      if (held === null) return;
      held.withdrawn = true;
      held.abort.abort();
    },
  };
}
