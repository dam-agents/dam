import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useBudgetReserved() {
  return useQuery({
    ...trpc.budgets.reserved.queryOptions(),
    staleTime: 5000,
  });
}

const POOL_USAGE_REFRESH_MS = 15_000;

export function usePoolUsage() {
  return useQuery({
    ...trpc.budgets.reserved.queryOptions(),
    staleTime: 5000,
    refetchInterval: POOL_USAGE_REFRESH_MS,
    select: (budget) => budget.vm ?? null,
  });
}
