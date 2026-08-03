import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/** The platform Telegram bot's handle — fixed for the install's lifetime. */
export function useTelegramBot() {
  return useQuery({
    ...trpc.channels.telegramBot.queryOptions(),
    staleTime: Infinity,
  });
}

/** Chats bound to an agent. No refetch interval — each call resolves chat
 *  titles against the Telegram Bot API. */
export function useTelegramChats(agentId: string | undefined) {
  return useQuery({
    ...trpc.agents.listTelegramChats.queryOptions({ agentId: agentId ?? "" }),
    enabled: !!agentId,
  });
}
