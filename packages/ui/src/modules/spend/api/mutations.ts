import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useSetSpendLimit() {
  return useMutation({
    ...trpc.spend.setLimit.mutationOptions(),
    meta: {
      invalidates: [trpc.spend.status.queryKey()],
      errorToast: "Couldn't save the spend limit",
    },
  });
}
