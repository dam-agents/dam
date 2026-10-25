import { and, eq, sql, channels as channelsTable, type Db } from "db";
import type { SessionPair } from "api-server-api";
import type { StoredProfileResolver } from "../../profiles/index.js";

/** UNIT_BOUNDARY_DESCRIPTION: the channel a turn belongs to, as the harness-agnostic row key: its type and the id that type uses. */
export interface ChannelRef {
  type: "slack" | "telegram";
  slackChannelId?: string;
  conversationId?: string;
}

export type ChannelPairResolver = (
  agentId: string,
  channel: ChannelRef,
) => Promise<SessionPair | null>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the pair a fresh channel session starts on, built
 * from the channel row's profile (D91, D119). A row with no profile, or one
 * whose profile cannot run on the agent, yields no pair, so the turn falls back
 * to the agent's default exactly as it did before profiles existed.
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
    const profileId = rows[0]?.profileId ?? null;
    if (profileId === null) return null;
    const resolved = await deps.resolver.resolveStored({
      profileId,
      agentId,
    });
    return resolved !== null && resolved.unavailable === null
      ? resolved.pair
      : null;
  };
}
