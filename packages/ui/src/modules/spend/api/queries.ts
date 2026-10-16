import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import type { SpendBreakdownInput } from "api-server-api";

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

export function useSpendBreakdown(input: SpendBreakdownInput) {
  return useQuery({
    ...trpc.spend.breakdown.queryOptions(input),
    refetchInterval: SPEND_REFRESH_MS * 2,
    placeholderData: keepPreviousData,
  });
}

export function useSpendMetering() {
  return useQuery({
    ...trpc.spend.metering.queryOptions(),
    staleTime: Infinity,
  });
}
