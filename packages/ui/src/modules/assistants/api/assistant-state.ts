import { useMutation, useQuery } from "@tanstack/react-query";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the server knows about the owner's assistant
 * without waking it — which Agent it is, whether it has ever been used, and the
 * one-time news that provisioning renamed another Agent — and the call that
 * dismisses that news for good.
 */
export function useAssistantState() {
  return useQuery(trpc.assistants.state.queryOptions());
}

export function useDismissAssistantNotice() {
  return useMutation(
    trpc.assistants.dismissNotice.mutationOptions({
      onSuccess: () =>
        queryClient.setQueryData(trpc.assistants.state.queryKey(), (prev) =>
          prev ? { ...prev, notice: null } : prev,
        ),
    }),
  );
}
