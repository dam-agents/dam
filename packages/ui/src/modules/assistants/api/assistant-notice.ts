import { useMutation, useQuery } from "@tanstack/react-query";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one-time news that provisioning the owner's
 * assistant renamed an Agent they already had, and the call that dismisses it
 * for good.
 */
export function useAssistantNotice() {
  return useQuery(trpc.assistants.notice.queryOptions());
}

export function useDismissAssistantNotice() {
  return useMutation(
    trpc.assistants.dismissNotice.mutationOptions({
      onSuccess: () =>
        queryClient.setQueryData(trpc.assistants.notice.queryKey(), null),
    }),
  );
}
