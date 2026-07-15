import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/** The platform Telegram bot's handle — fixed for the install's lifetime. */
export function useTelegramBot() {
  return useQuery({
    ...trpc.channels.telegramBot.queryOptions(),
    staleTime: Infinity,
  });
}
