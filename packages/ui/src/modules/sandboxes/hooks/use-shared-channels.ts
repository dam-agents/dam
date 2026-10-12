import { useMemo } from "react";

import { useAgents } from "../../agents/api/queries.js";
import { useTelegramChats } from "../../telegram/api/queries.js";
import { type SharedChannel, sharedChannels } from "../lib/shared-channels.js";
import { findSlackChannels } from "./use-slack-channel-form.js";

export function useSharedChannels(
  agentId: string,
): readonly SharedChannel[] | null {
  const agents = useAgents();
  const telegramReady = agents.data?.availableChannels?.telegram;
  const chats = useTelegramChats(telegramReady ? agentId : undefined).data
    ?.chats;
  return useMemo(() => {
    if (!agents.data) return null;
    if (telegramReady && !chats) return null;
    const agent = agents.data.list.find((a) => a.id === agentId);
    return sharedChannels(findSlackChannels(agent), chats ?? []);
  }, [agents.data, telegramReady, chats, agentId]);
}
