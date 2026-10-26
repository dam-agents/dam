import {
  and,
  eq,
  sql,
  channels as channelsTable,
  telegramConversations,
  type Db,
} from "db";
import { TRPCError } from "@trpc/server";
import type { SessionPair } from "api-server-api";
import type { ProfileResolver } from "../../profiles/index.js";

/** UNIT_BOUNDARY_DESCRIPTION: a channel whose profile cannot run on its agent refuses the turn with the reason, rather than running on a substitute the owner never chose (D91). */
export class ChannelProfileRefusedError extends Error {
  constructor(
    readonly profileName: string,
    readonly detail: string,
  ) {
    super(`this channel's profile "${profileName}" cannot run: ${detail}`);
    this.name = "ChannelProfileRefusedError";
  }
}

/** UNIT_BOUNDARY_DESCRIPTION: a Slack channel by its channel id, a Telegram chat by its conversation id; each keeps its profile on its own binding row. */
export interface ChannelRef {
  type: "slack" | "telegram";
  id: string;
}

export type ChannelPair = (
  agentId: string,
  channel: ChannelRef,
) => Promise<SessionPair | null>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the profile a channel's turns run on (D91). Read
 * only when a turn creates a session, so a resumed thread keeps the values it
 * runs on (D94 A, D119); null is a binding that predates profiles and keeps the
 * agent's channel default.
 */
export function createChannelProfiles(
  db: Db,
  resolveProfile: ProfileResolver,
): {
  pair: ChannelPair;
  set: (input: {
    owner: string;
    agentId: string;
    channel: ChannelRef;
    profileId: string | null;
  }) => Promise<void>;
} {
  const slackRow = (agentId: string, id: string) =>
    and(
      eq(channelsTable.agentId, agentId),
      eq(channelsTable.type, "slack"),
      sql`${channelsTable.config}->>'slackChannelId' = ${id}`,
    );
  const telegramRow = (agentId: string, id: string) =>
    and(
      eq(telegramConversations.agentId, agentId),
      eq(telegramConversations.conversationId, id),
    );

  return {
    async pair(agentId, channel) {
      const rows =
        channel.type === "slack"
          ? await db
              .select({ profileId: channelsTable.profileId })
              .from(channelsTable)
              .where(slackRow(agentId, channel.id))
          : await db
              .select({ profileId: telegramConversations.profileId })
              .from(telegramConversations)
              .where(telegramRow(agentId, channel.id));
      const profileId = rows[0]?.profileId;
      if (!profileId) return null;
      const resolved = await resolveProfile({ profileId, agentId });
      if (!resolved)
        throw new ChannelProfileRefusedError(profileId, "it no longer exists");
      if (resolved.unavailable)
        throw new ChannelProfileRefusedError(
          resolved.profile.name,
          resolved.unavailable,
        );
      return resolved.pair;
    },

    async set({ owner, agentId, channel, profileId }) {
      if (profileId !== null) {
        const resolved = await resolveProfile({ profileId, agentId, owner });
        if (!resolved)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Profile not found.",
          });
        if (resolved.unavailable)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `That profile cannot run on this agent: ${resolved.unavailable}.`,
          });
      }
      const rows =
        channel.type === "slack"
          ? await db
              .update(channelsTable)
              .set({ profileId })
              .where(slackRow(agentId, channel.id))
              .returning({ agentId: channelsTable.agentId })
          : await db
              .update(telegramConversations)
              .set({ profileId })
              .where(telegramRow(agentId, channel.id))
              .returning({ agentId: telegramConversations.agentId });
      if (rows.length === 0)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This agent has no such channel bound.",
        });
    },
  };
}
