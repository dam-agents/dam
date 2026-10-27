import type { z } from "zod";
import type { ChannelType } from "../shared.js";
import type { channelChoiceInputSchema } from "./router.js";

export type ChannelChoiceInput = z.infer<typeof channelChoiceInputSchema>;

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
  setChoice: (input: ChannelChoiceInput) => Promise<void>;
  slackChannelChoices: () => Promise<SlackChannelChoicesView>;
}
