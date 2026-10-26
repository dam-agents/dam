import type { ChannelType } from "../shared.js";

export interface SlackChannelChoiceView {
  id: string;
  name: string;
  isPrivate: boolean;
  workspace: string | null;
}

export type SlackChannelChoicesView =
  { linked: false } | { linked: true; channels: SlackChannelChoiceView[] };

export interface ChannelsService {
  available: Partial<Record<ChannelType, boolean>>;
  telegramBotUsername: () => string | null;
  setProfile: (input: {
    agentId: string;
    type: "slack" | "telegram";
    slackChannelId?: string;
    conversationId?: string;
    profileId: string | null;
  }) => Promise<void>;
  slackChannelChoices: () => Promise<SlackChannelChoicesView>;
}
