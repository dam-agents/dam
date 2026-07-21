import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useEndFork() {
  return useMutation({
    ...trpc.forks.end.mutationOptions(),
    meta: {
      // Ending a fork frees its reservation, so the budget meter refreshes
      // alongside both fork lists.
      invalidates: [
        trpc.forks.listByAgent.queryKey(),
        trpc.forks.listMine.queryKey(),
        trpc.budgets.reserved.queryKey(),
      ],
      errorToast: "Failed to end fork",
    },
  });
}
