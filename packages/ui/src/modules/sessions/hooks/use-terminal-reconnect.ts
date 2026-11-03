import {
  planReconnect,
  type ReconnectClock,
  type ReconnectStep,
  type TerminalDrop,
} from "api-server-api";
import { useCallback, useEffect, useRef, useState } from "react";

export interface ReconnectStatus {
  attempt: number;
  reason: string;
}

const STOPPED: ReconnectStep = { kind: "end", reason: "reconnect stopped" };

/**
 * UNIT_BOUNDARY_DESCRIPTION: the web terminal's side of reconnecting after a
 * lost connection. Each drop goes through `planReconnect`, the same rules
 * `dam chat` follows, and a retry calls `retry` after the step's delay. The
 * terminal reports the first frame of each connection with `live`, which
 * starts the give-up clock over. `stop` is the user's way out: it cancels the
 * pending retry, and every drop after it ends until a connection carries a
 * frame again.
 */
export function useTerminalReconnect(retry: () => void) {
  const [status, setStatus] = useState<ReconnectStatus | null>(null);
  const everLive = useRef(false);
  const stopped = useRef(false);
  const clock = useRef<ReconnectClock>({ attempt: 0, since: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clearTimer, [clearTimer]);

  const live = useCallback(() => {
    everLive.current = true;
    stopped.current = false;
    setStatus(null);
  }, []);

  const dropped = useCallback(
    (drop: TerminalDrop, wasLive: boolean): ReconnectStep => {
      const step = stopped.current
        ? STOPPED
        : planReconnect({
            drop,
            everLive: everLive.current,
            live: wasLive,
            clock: clock.current,
            now: Date.now(),
          });
      clearTimer();
      if (step.kind === "end") {
        setStatus(null);
        return step;
      }
      clock.current = step.clock;
      setStatus({ attempt: step.clock.attempt, reason: step.reason });
      timer.current = setTimeout(() => {
        timer.current = null;
        retry();
      }, step.delayMs);
      return step;
    },
    [clearTimer, retry],
  );

  const stop = useCallback(() => {
    stopped.current = true;
    clearTimer();
    setStatus(null);
  }, [clearTimer]);

  return { status, live, dropped, stop };
}
