import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useRecheckProviderKeys(opts: { silent?: boolean } = {}) {
  return useMutation({
    ...trpc.connections.recheckProviderKeys.mutationOptions(),
    meta: {
      invalidates: [trpc.connections.list.queryKey()],
      ...(opts.silent
        ? { suppressErrorToast: true }
        : { errorToast: "Couldn't recheck the provider keys" }),
    },
  });
}
