import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useTelegramBot() {
  return useQuery({
    ...trpc.channels.telegramBot.queryOptions(),
    staleTime: Infinity,
  });
}

export function useTelegramChats(agentId: string | undefined) {
  return useQuery({
    ...trpc.agents.listTelegramChats.queryOptions({ agentId: agentId ?? "" }),
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
