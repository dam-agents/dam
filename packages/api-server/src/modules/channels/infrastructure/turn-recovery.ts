import type { AcpTurnStatus } from "../../../core/acp-client.js";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";

const POLL_INTERVAL_MS = 2 * 60_000;
const RECOVERY_WINDOW_MS = 2 * 60 * 60_000;

export type WatchedTurnEnd = "clean" | "interrupted";

export interface WatchedTurn {
  instanceName: string;
  sessionId: string;
  isDelivered: (end: WatchedTurnEnd) => boolean;
  recover: (end: WatchedTurnEnd) => Promise<void>;
  onDone?: () => void;
}

export interface TurnRecovery {
  watch(turn: WatchedTurn, opts?: { endedAs?: WatchedTurnEnd }): void;
  dismiss(instanceName: string, sessionId: string): void;
  stop(): void;
}

interface WatchState {
  turn: WatchedTurn;
  gen: number;
  timer?: ReturnType<typeof setTimeout>;
  deadline: number;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Holds every channel turn whose relay watch
 * failed while the agent may still be working, and fires each turn's
 * recovery action exactly once, judged by how the work ended — never by
 * timing. A turn the runtime reports ended in-process made its full
 * disposition: it is recovered only when its refs carry no post, decline or
 * hand-off, the same verdict a never-abandoned turn gets. A turn the runtime
 * reports interrupted (boot recovery gave it up) never completed, so any
 * posts were partials: it is recovered unless its silence was deliberate,
 * and the resumed agent — context intact — posts the rest or declines. The
 * work is over only on a positive signal: one of those two statuses, or the
 * platform reporting the pod gone, which for a running turn means an ended
 * one because the idle checker never hibernates under it. A failed or
 * unreadable status poll is unknown and polled again, never an ending. A
 * turn reported alive is followed for as long as it runs — each alive report
 * pushes the give-up deadline out; the rolling window bounds only how long a
 * session that never shows life is polled, and in-process state means no
 * watch outlives the api-server anyway. Watches are generation-tagged so a
 * re-registered session invalidates the old watch's in-flight poll instead
 * of racing it; a later answering turn dismisses the watch, so a person who
 * re-asked never triggers a second answer; and every way a watch ends fires
 * its onDone hook — after the recovery action, where one runs — so the
 * caller's bookkeeping neither outlives the watch nor dies before the work
 * it guards (a reply landing while the recovery wakes the pod must still be
 * markable). Per-turn single-shot: a recovery that itself fails is logged
 * and given up, never retried into a loop. A caller that already knows how
 * the turn ended — a relay that watched it through to a clean finish, and
 * saw nothing delivered — registers it with that verdict instead: the poll
 * is skipped and the recovery is judged at once, on the same predicate,
 * single-shot rule and logging as a polled one, so the two ways a turn can
 * go undelivered have one owner rather than two.
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

  function remove(key: string): WatchState | undefined {
    const state = watches.get(key);
    if (state === undefined) return undefined;
    if (state.timer !== undefined) clearTimeout(state.timer);
    watches.delete(key);
    return state;
  }

  function drop(key: string): void {
    remove(key)?.turn.onDone?.();
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

    let verdict: AcpTurnStatus;
    try {
      verdict = await deps.turnStatus(turn.instanceName, turn.sessionId);
    } catch {
      verdict = (await deps.podGone(turn.instanceName).catch(() => false))
        ? "ended"
        : "unknown";
    }
    if (watches.get(key)?.gen !== gen) return;

    if (verdict === "pending") {
      state.deadline = Date.now() + RECOVERY_WINDOW_MS;
    }
    if (verdict === "pending" || verdict === "unknown") {
      schedule(key, turn, state);
      return;
    }

    await finish(
      key,
      turn,
      verdict === "interrupted" ? "interrupted" : "clean",
    );
  }

  async function finish(
    key: string,
    turn: WatchedTurn,
    end: WatchedTurnEnd,
  ): Promise<void> {
    remove(key);
    try {
      if (!turn.isDelivered(end)) await turn.recover(end);
    } catch (err) {
      getLogger().info(
        {
          agentId: turn.instanceName,
          sessionId: turn.sessionId,
          error: formatError(err),
        },
        "slack.turn.recovery_failed: the delivery nudge could not run",
      );
    } finally {
      turn.onDone?.();
    }
  }

  return {
    watch(turn, opts) {
      const key = keyOf(turn.instanceName, turn.sessionId);
      drop(key);
      const state: WatchState = {
        turn,
        gen: nextGen++,
        deadline: Date.now() + RECOVERY_WINDOW_MS,
      };
      watches.set(key, state);
      if (opts?.endedAs !== undefined) {
        void finish(key, turn, opts.endedAs);
        return;
      }
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
