import { ChannelType, type SessionView } from "api-server-api";
import { useCallback, useMemo } from "react";

import { useAgents } from "../../agents/api/queries.js";
import { slackChannelLabel } from "../../sandboxes/lib/slack-channels.js";
import { useTelegramChats } from "../../telegram/api/queries.js";
import { conversationLabel } from "./conversation-label.js";

type SessionConversationLabel = (session: SessionView) => string | undefined;

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
    (session: SessionView) =>
      conversationLabel(session, {
        slackByChannelId,
        telegramByConversationId,
      }),
    [slackByChannelId, telegramByConversationId],
  );
}
