import { useQueries } from "@tanstack/react-query";
import { ChannelType, SessionType } from "api-server-api";
import { useCallback, useMemo } from "react";

import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import { slackChannelLabel } from "../../sandboxes/lib/slack-channels.js";
import { conversationLabel } from "../../sessions/lib/conversation-label.js";
import type { FeedItem } from "../lib/feed-item.js";

const TELEGRAM_CHATS_STALE_MS = 60_000;

type FeedConversationLabel = (item: FeedItem) => string | undefined;

interface TelegramChatsPage {
  chats: readonly { conversationId: string; title: string }[];
}

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
 * UNIT_BOUNDARY_DESCRIPTION: Names the channel each feed row came from. The
 * feed spans every Agent the user owns, so Slack names come from the channel
 * list every Agent already carries, and Telegram chat titles are fetched only
 * for the Agents that have a Telegram row on the feed.
 */
export function useFeedConversations(
  items: readonly FeedItem[],
  agents: readonly AgentView[],
): FeedConversationLabel {
  const telegramReady = useAgents().data?.availableChannels?.telegram === true;

  const telegramAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.kind === "approval") continue;
      if (item.session.type === SessionType.ChannelTelegram)
        ids.add(item.agentId);
    }
    return [...ids].sort();
  }, [items]);

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
      ...trpc.agents.listTelegramChats.queryOptions({ agentId }),
      staleTime: TELEGRAM_CHATS_STALE_MS,
      retry: false,
    })),
    combine: combineTelegramChats,
  });

  return useCallback(
    (item: FeedItem) =>
      item.kind === "approval"
        ? undefined
        : conversationLabel(item.session, {
            slackByChannelId,
            telegramByConversationId,
          }),
    [slackByChannelId, telegramByConversationId],
  );
}
