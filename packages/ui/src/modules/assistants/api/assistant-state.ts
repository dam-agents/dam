import { useMutation, useQuery } from "@tanstack/react-query";
import { featureOnForUser } from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import {
  useFeatures,
  useInstallCapabilities,
} from "../../features/api/queries.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether this person has an assistant to hear about:
 * the install's mode decides, except in `experimental`, where their own switch
 * does. Nothing is asked of the server for anyone it is off for.
 */
export function useAssistantOn(): boolean {
  const install = useInstallCapabilities().data;
  const mode = install?.features.assistant;
  const { data: flags } = useFeatures(mode !== undefined);
  if (mode === undefined) return false;
  return featureOnForUser(mode, flags?.assistant ?? false);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the server knows about the owner's assistant
 * without waking it — which Agent it is, whether it has ever been used, and the
 * one-time news that provisioning renamed another Agent — and the call that
 * dismisses that news for good. A person the assistant is off for is asked
 * nothing at all.
 */
export function useAssistantState() {
  return useQuery({
    ...trpc.assistants.state.queryOptions(),
    enabled: useAssistantOn(),
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a Session that just appeared is the fact the
 * assistant's row learns only when the session report reaches the api-server.
 * Marking it here closes that window, so a New chat in the same page load does
 * not bring the greeting back. The Agent's own session list is the other half of
 * the same gate.
 */
export function markAssistantUsed(agentId: string): void {
  queryClient.setQueryData(trpc.assistants.state.queryKey(), (prev) =>
    prev?.agentId === agentId && !prev.used ? { ...prev, used: true } : prev,
  );
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
