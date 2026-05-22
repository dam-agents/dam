import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";

export class ConnectionClosedError extends Error {
  readonly name = "ConnectionClosedError";
  constructor() {
    super("Connection closed while request was in flight");
  }
}

// SDK methods that issue a JSON-RPC request via `Connection.sendRequest`. The
// SDK's receive loop never rejects `#pendingResponses` on stream close, so
// these calls hang indefinitely when the WebSocket dies mid-flight. Listed by
// name so adding a new SDK method is a deliberate decision rather than a
// silent leak through an unwrapped path.
const REQUEST_METHODS = new Set<string>([
  "initialize",
  "authenticate",
  "logout",
  "newSession",
  "loadSession",
  "forkSession",
  "listSessions",
  "unstable_resumeSession",
  "closeSession",
  "setSessionMode",
  "setSessionModel",
  "setSessionConfigOption",
  "prompt",
  "cancel",
]);

/**
 * Wrap a `ClientSideConnection` so every request-style method races against
 * the connection's `closed` promise. On close, in-flight calls reject with
 * `ConnectionClosedError` so consumer catch-paths can surface a real error
 * instead of awaiting a promise that will never settle.
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
      if (!REQUEST_METHODS.has(prop as string)) return value.bind(target);
      const fn = value as (...args: unknown[]) => Promise<unknown>;
      return (...args: unknown[]) =>
        Promise.race([fn.apply(target, args), closedThrows]);
    },
  });
}
