import { useMemo } from "react";

import { useAgents } from "../../agents/api/queries.js";
import { useTelegramChats } from "../../telegram/api/queries.js";
import {
  type SharedChannel,
  sharedChannels,
  type TelegramChat,
} from "../lib/shared-channels.js";
import { findSlackChannels } from "./use-slack-channel-form.js";

const NO_CHATS: readonly TelegramChat[] = [];

export function useSharedChannels(agentId: string): readonly SharedChannel[] {
  const agents = useAgents();
  const agent = agents.data?.list.find((a) => a.id === agentId);
  const telegramReady = agents.data?.availableChannels?.telegram;
  const chats = useTelegramChats(telegramReady ? agentId : undefined).data
    ?.chats;
  return useMemo(
    () => sharedChannels(findSlackChannels(agent), chats ?? NO_CHATS),
    [agent, chats],
  );
}
