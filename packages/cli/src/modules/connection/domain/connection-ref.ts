import type { ConnectionView } from "api-server-api";

export const CONNECTION_ID_PREFIX = "conn-";

export function resolveConnectionRef(
  connections: readonly ConnectionView[],
  ref: string,
): ConnectionView | null {
  if (ref.startsWith(CONNECTION_ID_PREFIX)) {
    return connections.find((c) => c.id === ref) ?? null;
  }
  return connections.find((c) => c.name === ref) ?? null;
}
