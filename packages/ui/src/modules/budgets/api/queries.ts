import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/** The caller's Reserved compute (sum of running sandbox Sizes) against
 *  their Ceiling. Polled while mounted — stops and pauses free room live. */
export function useBudgetReserved() {
  return useQuery({
    ...trpc.budgets.reserved.queryOptions(),
    refetchInterval: 5000,
    staleTime: 5000,
  });
}
