import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useRecheckProviderKeys() {
  return useMutation({
    ...trpc.connections.recheckProviderKeys.mutationOptions(),
    meta: {
      invalidates: [trpc.connections.list.queryKey()],
      errorToast: "Couldn't recheck the provider keys",
    },
  });
}
