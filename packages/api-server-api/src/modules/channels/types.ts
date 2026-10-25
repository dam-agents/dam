import type { ChannelType } from "../shared.js";

export interface ChannelsService {
  available: Partial<Record<ChannelType, boolean>>;
  telegramBotUsername: () => string | null;
  /** UNIT_BOUNDARY_DESCRIPTION: sets the profile the channel runs on; false when no channel of the owner matches the key. */
  setProfile: (input: {
    agentId: string;
    type: "slack" | "telegram";
    slackChannelId?: string;
    conversationId?: string;
    profileId: string | null;
  }) => Promise<boolean>;
}
