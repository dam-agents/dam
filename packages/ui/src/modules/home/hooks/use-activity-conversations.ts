import { useQueries } from "@tanstack/react-query";
import { type AttentionItem, ChannelType, SessionType } from "api-server-api";
import { useCallback, useMemo } from "react";

import type { AgentView } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import { slackChannelLabel } from "../../sandboxes/lib/slack-channels.js";
import { conversationLabel } from "../../sessions/lib/conversation-label.js";
import {
  type TelegramChatsPage,
  telegramChatsQueryOptions,
} from "../../telegram/api/queries.js";

type ConversationLabel = (session: AttentionItem) => string | undefined;

function combineTelegramChats(
  results: readonly { data?: TelegramChatsPage }[],
): ReadonlyMap<string, string> {
  const byId = new Map<string, string>();
  for (const result of results) {
    for (const chat of result.data?.chats ?? [])
      byId.set(chat.conversationId, chat.title);
  }
  return byId;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Names the channel each Activity session came
 * from. Activity spans every Agent the user owns, so Slack names come from the
 * channel list every Agent already carries, and Telegram chat titles are
 * fetched only for the Agents that have a Telegram session in Activity.
 */
export function useActivityConversations(
  sessions: readonly AttentionItem[],
  agents: readonly AgentView[],
): ConversationLabel {
  const telegramReady = useAgents().data?.availableChannels?.telegram === true;

  const telegramAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (session.type === SessionType.ChannelTelegram)
        ids.add(session.agentId);
    }
    return [...ids].sort();
  }, [sessions]);

  const slackByChannelId = useMemo(() => {
    const byId = new Map<string, string>();
    for (const agent of agents) {
      for (const channel of agent.channels) {
        if (channel.type === ChannelType.Slack)
          byId.set(channel.slackChannelId, slackChannelLabel(channel));
      }
    }
    return byId;
  }, [agents]);

  const telegramByConversationId = useQueries({
    queries: (telegramReady ? telegramAgentIds : []).map((agentId) => ({
      ...telegramChatsQueryOptions(agentId),
      retry: false,
    })),
    combine: combineTelegramChats,
  });

  return useCallback(
    (session: AttentionItem) =>
      conversationLabel(session, {
        slackByChannelId,
        telegramByConversationId,
      }),
    [slackByChannelId, telegramByConversationId],
  );
}
