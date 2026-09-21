import {
  ChannelType,
  isAmbientThreadKey,
  SessionType,
  type SessionView,
  slackChannelIdFromThreadKey,
} from "api-server-api";
import { useCallback, useMemo } from "react";

import { useAgents } from "../../agents/api/queries.js";
import { slackChannelLabel } from "../../sandboxes/hooks/use-slack-channel-form.js";
import { useTelegramChats } from "../../telegram/api/queries.js";

export type SessionConversationLabel = (
  session: SessionView,
) => string | undefined;

export function useSessionConversations(
  agentId: string | null,
): SessionConversationLabel {
  const agents = useAgents();
  const agent = agents.data?.list.find((a) => a.id === agentId);
  const telegramReady = agents.data?.availableChannels?.telegram;
  const telegramChats = useTelegramChats(
    telegramReady && agentId ? agentId : undefined,
  ).data?.chats;

  const slackByChannelId = useMemo(() => {
    const byId = new Map<string, string>();
    for (const channel of agent?.channels ?? []) {
      if (channel.type === ChannelType.Slack)
        byId.set(channel.slackChannelId, slackChannelLabel(channel));
    }
    return byId;
  }, [agent?.channels]);

  const telegramByConversationId = useMemo(() => {
    const byId = new Map<string, string>();
    for (const chat of telegramChats ?? [])
      byId.set(chat.conversationId, chat.title);
    return byId;
  }, [telegramChats]);

  return useCallback(
    (session: SessionView) => {
      if (session.type === SessionType.ChannelSlack) {
        const ambient = isAmbientThreadKey(session.threadTs);
        const channelId = slackChannelIdFromThreadKey(session.threadTs);
        const name = channelId ? slackByChannelId.get(channelId) : undefined;
        if (!name) return ambient ? "ambient" : undefined;
        return ambient ? `${name} · ambient` : name;
      }
      if (session.type === SessionType.ChannelTelegram)
        return session.threadTs
          ? telegramByConversationId.get(session.threadTs)
          : undefined;
      return undefined;
    },
    [slackByChannelId, telegramByConversationId],
  );
}
