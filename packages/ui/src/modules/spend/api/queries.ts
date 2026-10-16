import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import type { SpendDailyInput } from "api-server-api";

import { trpc } from "../../../trpc.js";

const SPEND_REFRESH_MS = 15_000;

export function useOwnerSpendStatus() {
  return useQuery({
    ...trpc.spend.status.queryOptions(),
    refetchInterval: SPEND_REFRESH_MS,
  });
}

export function useAgentSpendStatus(agentId: string | null) {
  return useQuery({
    ...trpc.spend.status.queryOptions(agentId ? { agentId } : skipToken),
    refetchInterval: SPEND_REFRESH_MS,
  });
}

export function useSpendDaily(input: SpendDailyInput) {
  return useQuery({
    ...trpc.spend.daily.queryOptions(input),
    refetchInterval: SPEND_REFRESH_MS * 2,
    placeholderData: keepPreviousData,
  });
}
