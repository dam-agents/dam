import { useMutation } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";

export function useStartCostReview() {
  return useMutation({
    mutationFn: (agentId: string) => api.costReviews.start.mutate({ agentId }),
    meta: {
      invalidates: [trpc.attention.listForOwner.queryKey()],
      errorToast: "Couldn't start the cost review",
    },
  });
}

export function useDismissCostReviews() {
  return useMutation({
    mutationFn: (agentIds: readonly string[]) =>
      api.costReviews.dismiss.mutate({ agentIds: [...agentIds] }),
    meta: {
      invalidates: [trpc.attention.listForOwner.queryKey()],
      errorToast: "Couldn't dismiss the cost review offer",
    },
  });
}
