import {
  and,
  eq,
  sql,
  channels as channelsTable,
  telegramConversations,
  type Db,
} from "db";
import type { StoredProfileResolver } from "../../profiles/index.js";
import {
  channelTurnPair,
  type ChannelPairDecision,
} from "../domain/channel-pair.js";

/** UNIT_BOUNDARY_DESCRIPTION: the channel a turn belongs to, as the harness-agnostic row key: its type and the id that type uses. */
export interface ChannelRef {
  type: "slack" | "telegram";
  slackChannelId?: string;
  conversationId?: string;
}

export type ChannelPairResolver = (
  agentId: string,
  channel: ChannelRef,
) => Promise<ChannelPairDecision>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a turn in a channel runs on, decided by the
 * rule in `channelTurnPair` from the profile its row names (D91). The row is
 * read per turn, so a profile edit reaches the channel's next fresh session.
 */
export function createChannelPairResolver(deps: {
  db: Db;
  resolver: StoredProfileResolver;
}): ChannelPairResolver {
  const profileOf = async (
    agentId: string,
    channel: ChannelRef,
  ): Promise<string | null> => {
    /* UNIT_BOUNDARY_DESCRIPTION: a Telegram binding is its own row, so the
     * profile is read from the table that binding lives in (B3). */
    if (channel.type === "telegram")
      return (
        (
          await deps.db
            .select({ profileId: telegramConversations.profileId })
            .from(telegramConversations)
            .where(
              and(
                eq(
                  telegramConversations.conversationId,
                  channel.conversationId ?? "",
                ),
                eq(telegramConversations.agentId, agentId),
              ),
            )
            .limit(1)
        )[0]?.profileId ?? null
      );
    const key = sql`${channelsTable.config}->>'slackChannelId' = ${channel.slackChannelId ?? ""}`;
    return (
      (
        await deps.db
          .select({ profileId: channelsTable.profileId })
          .from(channelsTable)
          .where(
            and(
              eq(channelsTable.agentId, agentId),
              eq(channelsTable.type, channel.type),
              key,
            ),
          )
          .limit(1)
      )[0]?.profileId ?? null
    );
  };
  return async (agentId, channel) => {
    return channelTurnPair({
      profileId: await profileOf(agentId, channel),
      agentId,
      resolveProfile: (input) => deps.resolver.resolveStored(input),
    });
  };
}
