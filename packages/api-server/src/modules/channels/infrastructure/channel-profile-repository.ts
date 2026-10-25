import {
  and,
  eq,
  sql,
  channels as channelsTable,
  telegramConversations,
  type Db,
} from "db";
import { displayNameForTemplate } from "api-server-api";
import type { StoredProfileResolver } from "../../profiles/index.js";

/** UNIT_BOUNDARY_DESCRIPTION: what writing a channel's profile did. A reference that could not run on the agent — or one whose provider the agent does not hold yet — is refused here rather than stored, so no channel is left naming a profile its turns would refuse. */
export type SetChannelProfileOutcome =
  | { outcome: "saved" }
  | { outcome: "no-such-channel" }
  | { outcome: "not-owned" }
  | {
      outcome: "unavailable";
      reason: string;
      /** UNIT_BOUNDARY_DESCRIPTION: the provider is the owner's and only the grant is missing, so the fix is the pick's own attach rather than a different profile. */
      attachable: boolean;
    };

/**
 * UNIT_BOUNDARY_DESCRIPTION: writes the profile a channel's turns run on, on
 * the row its type binds with, for the agent it was asked about (D91, B3). The
 * caller is already the agent's owner — an Agent Editor is re-bound to them —
 * so the row is scoped by the agent, never by whoever last wrote the binding
 * (B4), and the profile is resolved against that agent first: one the owner
 * does not hold, one whose provider is not attached, or one that cannot run here
 * is refused with its reason instead of being stored (R3).
 */
export function setChannelProfile(db: Db, resolver: StoredProfileResolver) {
  return async (input: {
    owner: string;
    agentId: string;
    type: "slack" | "telegram";
    slackChannelId?: string;
    conversationId?: string;
    profileId: string | null;
  }): Promise<SetChannelProfileOutcome> => {
    if (input.profileId !== null) {
      const resolved = await resolver.resolveStored({
        profileId: input.profileId,
        agentId: input.agentId,
        owner: input.owner,
      });
      if (resolved === null) return { outcome: "not-owned" };
      if (resolved.unavailable !== null)
        return {
          outcome: "unavailable",
          reason: resolved.unavailable.detail,
          attachable: resolved.grantableProvider !== null,
        };
      if (resolved.grantableProvider !== null)
        return {
          outcome: "unavailable",
          reason: `${displayNameForTemplate(resolved.profile.providerTemplate) ?? resolved.profile.providerTemplate} isn't attached to this agent yet`,
          attachable: true,
        };
    }
    const write = (profileId: string | null) =>
      input.type === "slack"
        ? db
            .update(channelsTable)
            .set({ profileId })
            .where(
              and(
                eq(channelsTable.agentId, input.agentId),
                eq(channelsTable.type, input.type),
                sql`${channelsTable.config}->>'slackChannelId' = ${input.slackChannelId ?? ""}`,
              ),
            )
            .returning({ agentId: channelsTable.agentId })
        : db
            .update(telegramConversations)
            .set({ profileId })
            .where(
              and(
                eq(
                  telegramConversations.conversationId,
                  input.conversationId ?? "",
                ),
                eq(telegramConversations.agentId, input.agentId),
              ),
            )
            .returning({ agentId: telegramConversations.agentId });
    const rows = await write(input.profileId);
    return { outcome: rows.length > 0 ? "saved" : "no-such-channel" };
  };
}
