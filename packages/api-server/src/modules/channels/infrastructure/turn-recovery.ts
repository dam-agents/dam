import type { AcpTurnStatus } from "../../../core/acp-client.js";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";

const POLL_INTERVAL_MS = 2 * 60_000;
const RECOVERY_WINDOW_MS = 2 * 60 * 60_000;

export interface WatchedTurn {
  instanceName: string;
  sessionId: string;
  deliveredSince: (sinceMs: number) => boolean;
  onStillRunning: () => void;
  recover: (sinceMs: number) => Promise<void>;
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
  lastAliveAt: number;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Holds every channel turn whose relay watch
 * failed while the agent may still be working, and fires each turn's
 * recovery action exactly once — when the runtime reports the work over and
 * no reply arrived after the agent was last seen working. That temporal rule
 * is the whole delivery verdict: a reply counts as the answer only if the
 * agent stopped working after it, so an early acknowledgement never masks a
 * lost result, and the agent's own late answer never triggers a second one.
 * The work is over only on a positive signal — the runtime says the turn
 * ended (or was abandoned by boot recovery), or the platform reports the pod
 * gone, which for a running turn means the same because the idle checker
 * never hibernates under one. A failed or unreadable status poll is treated
 * as unknown and polled again, never as an ending. A turn the runtime
 * reports alive is followed for as long as it runs — each alive report
 * pushes the give-up deadline out and lets the watcher keep its channel
 * bookkeeping fresh; the rolling window bounds only how long a session that
 * never shows life is polled, and in-process state means no watch outlives
 * the api-server anyway. Watches are generation-tagged so a re-registered
 * session invalidates the old watch's in-flight poll instead of racing it,
 * and a later answering turn dismisses the watch, so a person who re-asked
 * never triggers a second answer. Per-turn single-shot: a recovery that
 * itself fails is logged and given up, never retried into a loop.
 */
export function createTurnRecovery(deps: {
  turnStatus: (
    instanceName: string,
    sessionId: string,
  ) => Promise<AcpTurnStatus>;
  podGone: (instanceName: string) => Promise<boolean>;
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
    if (Date.now() > state.deadline) {
      drop(key);
      getLogger().info(
        { agentId: turn.instanceName, sessionId: turn.sessionId },
        "slack.turn.recovery_expired: the turn never ended within the recovery window",
      );
      return;
    }

    let verdict: "alive" | "over" | "unknown";
    try {
      const status = await deps.turnStatus(turn.instanceName, turn.sessionId);
      verdict =
        status === "pending" ? "alive" : status === "ended" ? "over" : "unknown";
    } catch {
      verdict = (await deps.podGone(turn.instanceName).catch(() => false))
        ? "over"
        : "unknown";
    }
    if (watches.get(key)?.gen !== gen) return;

    if (verdict === "alive") {
      state.lastAliveAt = Date.now();
      state.deadline = Date.now() + RECOVERY_WINDOW_MS;
      turn.onStillRunning();
    }
    if (verdict !== "over") {
      schedule(key, turn, state);
      return;
    }

    drop(key);
    if (turn.deliveredSince(state.lastAliveAt)) return;
    try {
      await turn.recover(state.lastAliveAt);
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
        lastAliveAt: Date.now(),
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
