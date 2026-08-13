import type { ConnectionView } from "api-server-api";
import { normalizeBobChatMode } from "api-server-api";

import type { BobModelPins } from "../../../types.js";

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

export function bobPinsFromConnection(
  conn: Pick<ConnectionView, "contributions">,
): BobModelPins {
  const env = new Map(
    conn.contributions
      .filter((c): c is Extract<typeof c, { kind: "env" }> => c.kind === "env")
      .map((c) => [c.name, c.placeholder] as const),
  );
  const chatMode = env.get("BOB_CHAT_MODE");
  return {
    model: env.get("BOB_SHELL_MODEL"),
    agentId: env.get("BOB_INSTANCE_ID"),
    teamId: env.get("BOB_TEAM_ID"),
    maxCost: env.get("BOB_MAX_COINS"),
    chatMode: chatMode ? normalizeBobChatMode(chatMode) : chatMode,
  };
}
