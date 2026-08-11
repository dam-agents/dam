import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";

export class ConnectionClosedError extends Error {
  readonly name = "ConnectionClosedError";
  /** What the socket said on the way out, when it said anything. The relay
   *  reports the cause here ("agent not ready: …", "upstream closed"). */
  readonly closeReason: string | null;
  constructor(closeReason: string | null) {
    super(
      closeReason
        ? `Connection closed while request was in flight: ${closeReason}`
        : "Connection closed while request was in flight",
    );
    this.closeReason = closeReason;
  }
}

/** The socket's parting reason, for a rejection that carries one. */
export function connectionCloseReason(e: unknown): string | null {
  return e instanceof ConnectionClosedError ? e.closeReason : null;
}

/** Whether a rejection is this module's close race rather than an answer from
 *  the agent — the two mean opposite things to the user. */
export function isConnectionClosed(e: unknown): boolean {
  return e instanceof ConnectionClosedError;
}

/**
 * Wrap a `ClientSideConnection` so every Promise-returning call races against
 * the connection's `closed` promise. On close, in-flight calls reject with
 * `ConnectionClosedError` so consumer catch-paths can surface a real error
 * instead of awaiting a promise that will never settle.
 *
 * Implementation detects requests dynamically — every public method on
 * `ClientSideConnection` returns a Promise, non-method members are getters
 * (`closed`, `signal`). This avoids a hand-maintained allowlist that would
 * silently disable the race for typos, new SDK methods, or future renames
 * (e.g. the `unstable_*` prefix dance).
 */
export function withCloseRace(
  conn: ClientSideConnection,
  closeReason: () => string | null,
): ClientSideConnection {
  const closedThrows = conn.closed.then(() => {
    throw new ConnectionClosedError(closeReason());
  });
  return new Proxy(conn, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const fn = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => {
        const result = fn.apply(target, args);
        return result instanceof Promise
          ? Promise.race([result, closedThrows])
          : result;
      };
    },
  });
}
