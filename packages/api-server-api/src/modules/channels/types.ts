import type { ChannelType } from "../shared.js";

/** UNIT_BOUNDARY_DESCRIPTION: what writing a channel's profile did. A binding that no longer exists, a profile the agent's owner does not hold, and one whose provider the agent does not hold are refusals the user sees, never a silent no-op and never a reference whose turns would refuse. */
export type SetChannelProfileResult =
  | { outcome: "saved" }
  | { outcome: "no-such-channel" }
  | { outcome: "not-owned" }
  | {
      outcome: "unavailable";
      reason: string;
      /** UNIT_BOUNDARY_DESCRIPTION: the provider is the owner's and only the grant is missing, so the pick's own attach fixes it. */
      attachable: boolean;
    };

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
