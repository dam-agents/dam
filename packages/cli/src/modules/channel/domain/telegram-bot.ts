export interface TelegramBotView {
  enabled: boolean;
  username: string | null;
  link: string | null;
}

export function telegramBotView(
  enabled: boolean,
  bot: { username: string } | null,
): TelegramBotView {
  const username = enabled && bot ? bot.username : null;
  return {
    enabled,
    username,
    link: username === null ? null : `https://t.me/${username}`,
  };
}
