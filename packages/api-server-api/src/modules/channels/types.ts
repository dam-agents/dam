import type { ChannelType } from "../shared.js";

/** UNIT_BOUNDARY_DESCRIPTION: what writing a channel's profile did, so a binding that no longer exists or a profile the agent's owner does not hold is a refusal the user sees, never a silent no-op. */
export type SetChannelProfileResult = "saved" | "no-such-channel" | "not-owned";

export interface ChannelsService {
  available: Partial<Record<ChannelType, boolean>>;
  telegramBotUsername: () => string | null;
  setProfile: (input: {
    agentId: string;
    type: "slack" | "telegram";
    slackChannelId?: string;
    conversationId?: string;
    profileId: string | null;
  }) => Promise<SetChannelProfileResult>;
}
