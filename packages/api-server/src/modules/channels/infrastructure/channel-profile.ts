import {
  and,
  eq,
  sql,
  channels as channelsTable,
  telegramConversations,
  type Db,
} from "db";
import { TRPCError } from "@trpc/server";
import type { SessionChoiceReferences, SessionPair } from "api-server-api";
import {
  choiceSlots,
  resolvedChoice,
} from "../../harness-config/domain/session-pair.js";
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
 * UNIT_BOUNDARY_DESCRIPTION: what a channel's turns run on (D91), kept in the
 * chat default's two slots and resolved as a chat start resolves them. Read
 * only when a turn creates a session, so a resumed thread keeps the values it
 * runs on (D94 A, D119); null is a binding with no pick of its own, as one bound
 * before profiles, which keeps the agent's channel default.
 */
export function createChannelProfiles(
  db: Db,
  resolveProfile: ProfileResolver,
): {
  pair: ChannelPair;
  set: (input: {
    agentId: string;
    channel: ChannelRef;
    pair: SessionPair | null;
    references: SessionChoiceReferences;
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
      const table =
        channel.type === "slack" ? channelsTable : telegramConversations;
      const rows = await db
        .select({
          profileId: table.profileId,
          pair: table.sessionPair,
          platformSubagentProfileId: table.platformSubagentProfile,
          platformSubagentSettings: table.platformSubagentSettings,
        })
        .from(table)
        .where(
          channel.type === "slack"
            ? slackRow(agentId, channel.id)
            : telegramRow(agentId, channel.id),
        );
      const row = rows[0];
      if (!row) return null;
      const resolved = await resolvedChoice(
        {
          profileId: row.profileId,
          pair: row.pair as SessionPair | null,
          platformSubagentProfileId: row.platformSubagentProfileId,
          platformSubagentSettings: row.platformSubagentSettings as Record<
            string,
            string
          > | null,
        },
        resolveProfile,
        agentId,
      );
      if (resolved.refused)
        throw new ChannelProfileRefusedError(
          resolved.refused.profile,
          resolved.refused.detail,
        );
      return resolved.pair;
    },

    /* UNIT_BOUNDARY_DESCRIPTION: stores a pick the caller has checked as a chat default's pick is checked; an omitted subagent reference leaves that slot as it is. */
    async set({ agentId, channel, pair, references }) {
      const slots = choiceSlots(pair, references);
      const values = {
        profileId: slots.profileId,
        sessionPair: slots.pair,
        ...(slots.platformSubagentProfileId !== undefined && {
          platformSubagentProfile: slots.platformSubagentProfileId,
          platformSubagentSettings: slots.platformSubagentSettings,
        }),
      };
      const rows =
        channel.type === "slack"
          ? await db
              .update(channelsTable)
              .set(values)
              .where(slackRow(agentId, channel.id))
              .returning({ agentId: channelsTable.agentId })
          : await db
              .update(telegramConversations)
              .set(values)
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
