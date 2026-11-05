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
 * does — and `known` says whether both answers are in, so a caller that must not
 * decide on a guess can wait. Nothing is asked of the server for anyone it is
 * off for.
 */
export function useAssistantGate(): { on: boolean; known: boolean } {
  const install = useInstallCapabilities();
  const mode = install.data?.features.dambledore;
  const flags = useFeatures(mode !== undefined);
  if (!install.isSuccess || mode === undefined)
    return { on: false, known: false };
  if (mode !== "experimental") return { on: mode === "on", known: true };
  if (!flags.isSuccess) return { on: false, known: false };
  return {
    on: featureOnForUser(mode, flags.data.dambledore ?? false),
    known: true,
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: whether the person has the assistant, as far as the client knows; the landing asks `useAssistantGate` when it must also know that the answer is in. */
export function useAssistantOn(): boolean {
  return useAssistantGate().on;
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
