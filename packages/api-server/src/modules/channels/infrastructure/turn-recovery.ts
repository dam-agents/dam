import type { AcpTurnStatus } from "../../../core/acp-client.js";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";

const POLL_INTERVAL_MS = 2 * 60_000;
const RECOVERY_WINDOW_MS = 2 * 60 * 60_000;
const ENDED_AFTER_CONNECT_FAILURES = 2;

export interface WatchedTurn {
  instanceName: string;
  sessionId: string;
  isDelivered: () => boolean;
  onStillRunning: () => void;
  recover: () => Promise<void>;
}

export interface TurnRecovery {
  watch(turn: WatchedTurn): void;
  dismiss(instanceName: string, sessionId: string): void;
  stop(): void;
}

interface WatchState {
  gen: number;
  timer?: ReturnType<typeof setTimeout>;
  deadline: number;
  connectFailures: number;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Holds every channel turn whose relay watch
 * failed while the agent may still be working, and fires each turn's
 * recovery action exactly once — when the runtime reports the turn over (or
 * the pod is gone, which for a running turn means the same: the idle checker
 * never hibernates under one) and nothing was delivered to the thread. A
 * turn whose reply arrives on its own is dropped without recovery, and a
 * later turn answering on the same session dismisses the watch, so a person
 * who re-asked never triggers a second answer. A turn still running is left
 * alone however long it takes — each alive report pushes the give-up
 * deadline out and lets the watcher keep its channel bookkeeping fresh; the
 * window bounds only how long an unanswerable session is polled. Watches are
 * generation-tagged so a re-registered session invalidates the old watch's
 * in-flight poll instead of racing it. State is in-process and per-turn
 * single-shot, so a recovery that itself fails is logged and given up, never
 * retried into a loop.
 */
export function createTurnRecovery(deps: {
  turnStatus: (
    instanceName: string,
    sessionId: string,
  ) => Promise<AcpTurnStatus>;
}): TurnRecovery {
  const watches = new Map<string, WatchState>();
  let nextGen = 1;

  function keyOf(instanceName: string, sessionId: string): string {
    return `${instanceName} ${sessionId}`;
  }

  function drop(key: string): void {
    const state = watches.get(key);
    if (state === undefined) return;
    if (state.timer !== undefined) clearTimeout(state.timer);
    watches.delete(key);
  }

  function schedule(key: string, turn: WatchedTurn, state: WatchState): void {
    state.timer = setTimeout(
      () => void tick(key, turn, state.gen),
      POLL_INTERVAL_MS,
    );
  }

  async function tick(
    key: string,
    turn: WatchedTurn,
    gen: number,
  ): Promise<void> {
    const state = watches.get(key);
    if (state === undefined || state.gen !== gen) return;
    if (turn.isDelivered()) {
      drop(key);
      return;
    }
    if (Date.now() > state.deadline) {
      drop(key);
      getLogger().info(
        { agentId: turn.instanceName, sessionId: turn.sessionId },
        "slack.turn.recovery_expired: the turn never ended within the recovery window",
      );
      return;
    }

    let ended = false;
    try {
      const status = await deps.turnStatus(turn.instanceName, turn.sessionId);
      state.connectFailures = 0;
      if (status === "pending") {
        state.deadline = Date.now() + RECOVERY_WINDOW_MS;
        turn.onStillRunning();
      }
      ended = status === "ended";
    } catch {
      state.connectFailures += 1;
      ended = state.connectFailures >= ENDED_AFTER_CONNECT_FAILURES;
    }
    if (watches.get(key)?.gen !== gen) return;

    if (!ended) {
      schedule(key, turn, state);
      return;
    }

    drop(key);
    if (turn.isDelivered()) return;
    try {
      await turn.recover();
    } catch (err) {
      getLogger().info(
        {
          agentId: turn.instanceName,
          sessionId: turn.sessionId,
          error: formatError(err),
        },
        "slack.turn.recovery_failed: the delivery nudge could not run",
      );
    }
  }

  return {
    watch(turn) {
      const key = keyOf(turn.instanceName, turn.sessionId);
      drop(key);
      const state: WatchState = {
        gen: nextGen++,
        deadline: Date.now() + RECOVERY_WINDOW_MS,
        connectFailures: 0,
      };
      watches.set(key, state);
      schedule(key, turn, state);
    },

    dismiss(instanceName, sessionId) {
      drop(keyOf(instanceName, sessionId));
    },

    stop() {
      for (const key of [...watches.keys()]) drop(key);
    },
  };
}
