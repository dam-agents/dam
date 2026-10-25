import { and, eq, sql, channels as channelsTable, type Db } from "db";

/** UNIT_BOUNDARY_DESCRIPTION: writes the profile a channel runs on, by the key its type uses, so the UI never has to name a row. */
export function setChannelProfile(db: Db) {
  return async (input: {
    owner: string;
    agentId: string;
    type: "slack" | "telegram";
    slackChannelId?: string;
    conversationId?: string;
    profileId: string | null;
  }): Promise<boolean> => {
    const key =
      input.type === "slack"
        ? sql`${channelsTable.config}->>'slackChannelId' = ${input.slackChannelId ?? ""}`
        : sql`${channelsTable.config}->>'conversationId' = ${input.conversationId ?? ""}`;
    const rows = await db
      .update(channelsTable)
      .set({ profileId: input.profileId })
      .where(
        and(
          eq(channelsTable.owner, input.owner),
          eq(channelsTable.agentId, input.agentId),
          eq(channelsTable.type, input.type),
          key,
        ),
      )
      .returning({ agentId: channelsTable.agentId });
    return rows.length > 0;
  };
}
