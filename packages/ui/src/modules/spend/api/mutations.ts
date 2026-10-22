import { useMutation } from "@tanstack/react-query";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

function refetchCeilings() {
  void queryClient.invalidateQueries({
    queryKey: trpc.spend.ceilings.list.queryKey(),
  });
}

export function useSetSpendCeiling({ inlineErrors = false } = {}) {
  const invalidates = [
    trpc.spend.ceilings.list.queryKey(),
    trpc.spend.status.queryKey(),
  ];
  return useMutation({
    ...trpc.spend.ceilings.set.mutationOptions({ onError: refetchCeilings }),
    meta: inlineErrors
      ? { invalidates, suppressErrorToast: true }
      : { invalidates, errorToast: "Couldn't save the spend ceiling" },
  });
}

export function useSetSpendLimit() {
  return useMutation({
    ...trpc.spend.setLimit.mutationOptions(),
    meta: {
      invalidates: [trpc.spend.status.queryKey()],
      errorToast: "Couldn't save the spend limit",
    },
  });
}
