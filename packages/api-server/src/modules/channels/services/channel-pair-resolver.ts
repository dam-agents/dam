import { and, eq, sql, channels as channelsTable, type Db } from "db";
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
  return async (agentId, channel) => {
    const key =
      channel.type === "slack"
        ? sql`${channelsTable.config}->>'slackChannelId' = ${channel.slackChannelId ?? ""}`
        : sql`${channelsTable.config}->>'conversationId' = ${channel.conversationId ?? ""}`;
    const rows = await deps.db
      .select({ profileId: channelsTable.profileId })
      .from(channelsTable)
      .where(
        and(
          eq(channelsTable.agentId, agentId),
          eq(channelsTable.type, channel.type),
          key,
        ),
      )
      .limit(1);
    return channelTurnPair({
      profileId: rows[0]?.profileId ?? null,
      agentId,
      resolveProfile: (input) => deps.resolver.resolveStored(input),
    });
  };
}
