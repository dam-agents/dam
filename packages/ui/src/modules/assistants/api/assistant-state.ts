import { useMutation, useQuery } from "@tanstack/react-query";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useInstallCapabilities } from "../../features/api/queries.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the server knows about the owner's assistant
 * without waking it — which Agent it is, whether it has ever been used, and the
 * one-time news that provisioning renamed another Agent — and the call that
 * dismisses that news for good. An install that offers no assistant is asked
 * nothing at all.
 */
export function useAssistantState() {
  const install = useInstallCapabilities().data;
  return useQuery({
    ...trpc.assistants.state.queryOptions(),
    enabled: install !== undefined && install.features.assistant !== "off",
  });
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
