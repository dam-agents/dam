import type { ConnectionView } from "api-server-api";
import { normalizeBobChatMode } from "api-server-api";

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

// Bob's config inputs ride as `env` contributions whose placeholder holds the
// (non-secret) value, keyed by the same env names the legacy pins use.
export function bobPinsFromConnection(conn: ConnectionView): BobModelPins {
  const env = new Map(
    conn.contributions
      .filter((c): c is Extract<typeof c, { kind: "env" }> => c.kind === "env")
      .map((c) => [c.name, c.placeholder] as const),
  );
  // A pre-2.0 secret can pin a mode 2.0 merged away; normalize on the way out so
  // the edit form shows (and validates) a mode that still exists, instead of
  // going invalid at mount over a field the user never touched.
  const chatMode = env.get("BOB_CHAT_MODE");
  return {
    model: env.get("BOB_SHELL_MODEL"),
    agentId: env.get("BOB_INSTANCE_ID"),
    teamId: env.get("BOB_TEAM_ID"),
    maxCost: env.get("BOB_MAX_COINS"),
    chatMode: chatMode ? normalizeBobChatMode(chatMode) : chatMode,
  };
}
