import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useAcceptTerms() {
  return useMutation({
    ...trpc.terms.accept.mutationOptions(),
    meta: {
      invalidates: [trpc.terms.latestAcceptance.queryKey()],
      errorToast: "Couldn't accept Terms of Use",
    },
  });
}
