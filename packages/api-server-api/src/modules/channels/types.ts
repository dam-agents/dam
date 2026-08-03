import type { ChannelType } from "../shared.js";

export interface ChannelsService {
  available: Partial<Record<ChannelType, boolean>>;
  /** Username of the platform-wide Telegram bot (without the @), resolved
   *  via getMe when the bot starts; null when Telegram is disabled or the
   *  bot hasn't started. Lets clients render a t.me link. */
  telegramBotUsername: () => string | null;
}
