import type { ConnectionView } from "api-server-api";

import type { BobModelPins } from "../../../types.js";

// A provider is backed by a Connection — the single credential model.
export interface ProviderRef {
  id: string;
}

export interface ProviderItem {
  id: string;
  conn: ConnectionView;
}

export function providerRef(item: ProviderItem): ProviderRef {
  return { id: item.id };
}

export function sameProviderRef(a: ProviderRef, b: ProviderRef): boolean {
  return a.id === b.id;
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
