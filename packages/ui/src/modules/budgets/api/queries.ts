import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useBudgetReserved() {
  return useQuery({
    ...trpc.budgets.reserved.queryOptions(),
    staleTime: 5000,
  });
}
