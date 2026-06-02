import type { ConnectionView } from "api-server-api";

export const CONNECTION_ID_PREFIX = "conn-";

/**
 * Resolve a user-supplied ref — a `conn-…` id or a connection name — to a
 * connection. Names are unique per owner (DB-enforced), so a name maps to at
 * most one connection; no ambiguity is possible. Returns null when nothing
 * matches.
 */
export function resolveConnectionRef(
  connections: readonly ConnectionView[],
  ref: string,
): ConnectionView | null {
  if (ref.startsWith(CONNECTION_ID_PREFIX)) {
    return connections.find((c) => c.id === ref) ?? null;
  }
  return connections.find((c) => c.name === ref) ?? null;
}
