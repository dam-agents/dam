import type { ConnectionView } from "api-server-api";

export const CONNECTION_ID_PREFIX = "conn-";

export function resolveConnectionRef(
  connections: readonly ConnectionView[],
  ref: string,
): ConnectionView | null {
  if (ref.startsWith(CONNECTION_ID_PREFIX)) {
    return connections.find((c) => c.id === ref) ?? null;
  }
  const named = connections.filter((c) => c.name === ref);
  const parents = named.filter((c) => c.isParent);
  return (
    named.find((c) => !c.isParent) ??
    (parents.length === 1 ? parents[0]! : null)
  );
}

export function unresolvedConnectionRef(
  connections: readonly ConnectionView[],
  ref: string,
): string {
  const parents = connections.filter((c) => c.isParent && c.name === ref);
  if (!ref.startsWith(CONNECTION_ID_PREFIX) && parents.length > 1) {
    return (
      `error: ${parents.length} GitHub sign-ins or installations are named '${ref}'\n` +
      `hint: pass the id of one: ${parents.map((p) => p.id).join(", ")}\n`
    );
  }
  return (
    `error: no connection with id or name '${ref}'\n` +
    "hint: run `dam connection list` to see ids and names\n"
  );
}
