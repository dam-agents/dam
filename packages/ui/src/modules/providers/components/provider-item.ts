import type { ConnectionView } from "api-server-api";

import type { BobModelPins, SecretView } from "../../../types.js";

// A provider can be backed by a Connection (new setup) or, during the
// transition, a legacy provider Secret. Selections are tagged by source so
// each surface routes grants to the right rail.
export type ProviderRef =
  | { source: "connection"; id: string }
  | { source: "secret"; id: string };

export type ProviderItem =
  | { source: "connection"; id: string; conn: ConnectionView }
  | { source: "secret"; id: string; secret: SecretView };

export function providerRef(item: ProviderItem): ProviderRef {
  return item.source === "connection"
    ? { source: "connection", id: item.id }
    : { source: "secret", id: item.id };
}

export function sameProviderRef(a: ProviderRef, b: ProviderRef): boolean {
  return a.source === b.source && a.id === b.id;
}

// Bob's config inputs ride as `env` contributions whose placeholder holds the
// (non-secret) value, keyed by the same env names the legacy pins use.
export function bobPinsFromConnection(conn: ConnectionView): BobModelPins {
  const env = new Map(
    conn.contributions
      .filter((c): c is Extract<typeof c, { kind: "env" }> => c.kind === "env")
      .map((c) => [c.name, c.placeholder] as const),
  );
  return {
    model: env.get("BOB_SHELL_MODEL"),
    agentId: env.get("BOB_INSTANCE_ID"),
    teamId: env.get("BOB_TEAM_ID"),
    maxCoins: env.get("BOB_MAX_COINS"),
    chatMode: env.get("BOB_CHAT_MODE"),
  };
}
