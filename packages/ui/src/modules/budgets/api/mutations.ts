import { useMutation } from "@tanstack/react-query";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

function refetchBudgets() {
  void queryClient.invalidateQueries({
    queryKey: trpc.budgets.users.pathKey(),
  });
}

const invalidates = () => [
  trpc.budgets.users.pathKey(),
  trpc.budgets.reserved.queryKey(),
];

export function useSetUserBudget() {
  return useMutation({
    ...trpc.budgets.users.set.mutationOptions({
      onSettled: (_data, error) => {
        if (error) refetchBudgets();
      },
    }),
    meta: { invalidates: invalidates(), suppressErrorToast: true },
  });
}

export function useRemoveUserBudget() {
  return useMutation({
    ...trpc.budgets.users.remove.mutationOptions({
      onSettled: (_data, error) => {
        if (error) refetchBudgets();
      },
    }),
    meta: {
      invalidates: invalidates(),
      errorToast: "Couldn't remove the compute budget",
    },
  });
}
