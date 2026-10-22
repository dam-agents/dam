import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useSetSpendCeiling({ inlineErrors = false } = {}) {
  const invalidates = [
    trpc.spend.ceilings.list.queryKey(),
    trpc.spend.status.queryKey(),
  ];
  return useMutation({
    ...trpc.spend.ceilings.set.mutationOptions(),
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
