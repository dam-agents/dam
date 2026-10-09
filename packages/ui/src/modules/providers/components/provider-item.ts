import type { ConnectionUpdateInput, ConnectionView } from "api-server-api";
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

export function bobConfigInputs(pins: BobModelPins): Record<string, string> {
  const out: Record<string, string> = {};
  if (pins.model) out.model = pins.model;
  if (pins.agentId) out.instanceId = pins.agentId;
  if (pins.teamId) out.teamId = pins.teamId;
  if (pins.maxCost) out.maxCost = pins.maxCost;
  if (pins.chatMode) out.chatMode = pins.chatMode;
  return out;
}

export function bobUpdateInput(
  id: string,
  value: string,
  pins: BobModelPins,
): ConnectionUpdateInput {
  return {
    id,
    configInputs: bobConfigInputs(pins),
    ...(value ? { value } : {}),
  };
}
