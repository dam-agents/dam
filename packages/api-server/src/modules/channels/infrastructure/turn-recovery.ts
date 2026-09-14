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
  recover: () => Promise<void>;
}

export interface TurnRecovery {
  watch(turn: WatchedTurn): void;
  stop(): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Holds every channel turn whose relay watch
 * failed while the agent may still be working, and fires each turn's
 * recovery action exactly once — when the runtime reports the turn over (or
 * the pod is gone, which for a running turn means the same: the idle checker
 * never hibernates under one) and nothing was delivered to the thread. A
 * turn whose reply arrives on its own is dropped without recovery; a turn
 * still running is left alone however long it takes, bounded only by the
 * recovery window. State is in-process and per-turn single-shot, so a
 * recovery that itself fails is logged and given up, never retried into a
 * loop.
 */
export function createTurnRecovery(deps: {
  turnStatus: (instanceName: string, sessionId: string) => Promise<AcpTurnStatus>;
}): TurnRecovery {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function drop(key: string): void {
    const timer = timers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(key);
  }

  function schedule(
    key: string,
    turn: WatchedTurn,
    state: { deadline: number; connectFailures: number },
  ): void {
    timers.set(
      key,
      setTimeout(() => void tick(key, turn, state), POLL_INTERVAL_MS),
    );
  }

  async function tick(
    key: string,
    turn: WatchedTurn,
    state: { deadline: number; connectFailures: number },
  ): Promise<void> {
    if (!timers.has(key)) return;
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
      ended = status === "ended";
    } catch {
      state.connectFailures += 1;
      ended = state.connectFailures >= ENDED_AFTER_CONNECT_FAILURES;
    }
    if (!timers.has(key)) return;

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
      const key = `${turn.instanceName} ${turn.sessionId}`;
      drop(key);
      schedule(key, turn, {
        deadline: Date.now() + RECOVERY_WINDOW_MS,
        connectFailures: 0,
      });
    },

    stop() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
