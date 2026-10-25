import {
  and,
  eq,
  sql,
  channels as channelsTable,
  profiles as profilesTable,
  telegramConversations,
  type Db,
} from "db";

/** UNIT_BOUNDARY_DESCRIPTION: the row a channel's binding lives on, by the key its type uses: a Slack binding is a `channels` row, a Telegram one a `telegram_conversations` row. */
function bindingKey(input: { type: "slack" | "telegram" }) {
  return input.type === "slack" ? "slack" : "telegram";
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: writes the profile a channel's turns run on, on
 * the row its type binds with, for the agent it was asked about (D91, B3). The
 * caller is already the agent's owner — an Agent Editor is re-bound to them —
 * so the row is scoped by the agent, never by whoever last wrote the binding,
 * and a profile the agent's owner does not hold is refused here rather than
 * stored as a reference that resolves to nothing (B4).
 */
export function setChannelProfile(db: Db) {
  return async (input: {
    owner: string;
    agentId: string;
    type: "slack" | "telegram";
    slackChannelId?: string;
    conversationId?: string;
    profileId: string | null;
  }): Promise<"saved" | "no-such-channel" | "not-owned"> => {
    if (input.profileId !== null) {
      const owned = await db
        .select({ id: profilesTable.id })
        .from(profilesTable)
        .where(
          and(
            eq(profilesTable.id, input.profileId),
            eq(profilesTable.owner, input.owner),
          ),
        )
        .limit(1);
      if (owned.length === 0) return "not-owned";
    }
    if (bindingKey(input) === "slack") {
      const key = sql`${channelsTable.config}->>'slackChannelId' = ${input.slackChannelId ?? ""}`;
      const rows = await db
        .update(channelsTable)
        .set({ profileId: input.profileId })
        .where(
          and(
            eq(channelsTable.agentId, input.agentId),
            eq(channelsTable.type, input.type),
            key,
          ),
        )
        .returning({ agentId: channelsTable.agentId });
      return rows.length > 0 ? "saved" : "no-such-channel";
    }
    const rows = await db
      .update(telegramConversations)
      .set({ profileId: input.profileId })
      .where(
        and(
          eq(telegramConversations.conversationId, input.conversationId ?? ""),
          eq(telegramConversations.agentId, input.agentId),
        ),
      )
      .returning({ agentId: telegramConversations.agentId });
    return rows.length > 0 ? "saved" : "no-such-channel";
  };
}
