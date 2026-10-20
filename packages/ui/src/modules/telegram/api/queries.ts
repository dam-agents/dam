import { skipToken, useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { trpc } from "../../../trpc.js";

export type TelegramChatsPage = inferOutput<
  typeof trpc.agents.listTelegramChats
>;

export function telegramChatsQueryOptions(agentId: string) {
  return {
    ...trpc.agents.listTelegramChats.queryOptions({ agentId }),
    staleTime: 60_000,
  };
}

export function useTelegramBot() {
  return useQuery({
    ...trpc.channels.telegramBot.queryOptions(),
    staleTime: Infinity,
  });
}

export function useTelegramChats(agentId: string | undefined) {
  return useQuery({
    ...telegramChatsQueryOptions(agentId ?? ""),
    enabled: !!agentId,
  });
}

export function useTelegramBindFlow(flowId: string | null) {
  return useQuery({
    ...trpc.agents.peekTelegramBindFlow.queryOptions(
      flowId ? { flowId } : skipToken,
    ),
    staleTime: Infinity,
    retry: false,
  });
}
