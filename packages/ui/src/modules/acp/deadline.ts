/**
 * Deadline for the session-history load (`initialize` + `session/load` on the
 * throwaway WebSocket). Without one, the spinner is hostage to the slowest
 * link in a chain that has no other timeout: the api-server relay is a dumb
 * proxy that keeps the socket open indefinitely, and the runtime's cold
 * bootstrap waits on the harness subprocess with no deadline — a wedged or
 * never-spawning harness means `loadSession` simply never settles.
 *
 * Kept import-free of browser-touching modules so node-environment unit
 * tests can use it directly (same reason `errors.ts` and `close-race.ts`
 * stand alone).
 */

/**
 * Generous on purpose: the relay completes the WS upgrade immediately and
 * only then wakes a hibernated pod, so a legitimate cold resume can spend
 * a minute-plus between our `initialize` send and the first response.
 * Matches `WS_CONNECT_TIMEOUT_MS` — the budget we already grant the
 * connection itself.
 */
export const SESSION_LOAD_TIMEOUT_MS = 120_000;

export class SessionLoadTimeoutError extends Error {
  readonly name = "SessionLoadTimeoutError";
  constructor(ms: number) {
    super(
      `The agent didn't return the session history within ${Math.round(ms / 1000)}s. ` +
        "It may be stuck starting up — try again, or check the agent's status.",
    );
  }
}

/** Race `promise` against a timer; rejects with `SessionLoadTimeoutError`
 *  once `ms` elapses. The timer is cleared as soon as `promise` settles, so
 *  no stray rejection outlives the winner. */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SessionLoadTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
