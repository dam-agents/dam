import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";

export class ConnectionClosedError extends Error {
  readonly name = "ConnectionClosedError";
  constructor() {
    super("Connection closed while request was in flight");
  }
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
): ClientSideConnection {
  const closedThrows = conn.closed.then(() => {
    throw new ConnectionClosedError();
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
