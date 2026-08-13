import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";

export class ConnectionClosedError extends Error {
  readonly name = "ConnectionClosedError";
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

export function connectionCloseReason(e: unknown): string | null {
  return e instanceof ConnectionClosedError ? e.closeReason : null;
}

export function isConnectionClosed(e: unknown): boolean {
  return e instanceof ConnectionClosedError;
}

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
