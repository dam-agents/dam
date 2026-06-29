import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/** The caller's reserved CPU/memory against their concurrent ceiling. */
export function useBudgetUsage() {
  return useQuery({
    ...trpc.budgets.usage.queryOptions(),
    refetchInterval: 5000,
    staleTime: 5000,
  });
}
