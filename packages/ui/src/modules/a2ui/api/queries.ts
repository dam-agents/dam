import { useMutation, useQuery } from "@tanstack/react-query";

import type { ChatFormPreferences } from "api-server-api/chat-forms";

import { trpc } from "../../../trpc.js";

// @ts-expect-error chatForms router not on this branch; MSW intercepts at HTTP level
const chatFormsProxy = trpc.chatForms as {
  preferences: { queryOptions: (input: { agentId: string }) => { queryKey: unknown[]; queryFn: () => Promise<ChatFormPreferences> }; queryKey: () => unknown[] };
  setPreferences: { mutationOptions: () => { mutationFn: (input: { agentId: string; preferences: ChatFormPreferences }) => Promise<ChatFormPreferences> } };
};

export function useChatFormPreferences(
  agentId: string | null,
  { quiet = false }: { quiet?: boolean } = {},
) {
  return useQuery({
    ...chatFormsProxy.preferences.queryOptions({ agentId: agentId ?? "" }),
    enabled: agentId !== null && agentId !== "",
    staleTime: 5 * 60_000,
    ...(quiet
      ? { retry: false }
      : { meta: { errorToast: "Couldn't load the chat form settings" } }),
  });
}

export function useSetChatFormPreferences() {
  return useMutation({
    ...chatFormsProxy.setPreferences.mutationOptions(),
    meta: {
      invalidates: [chatFormsProxy.preferences.queryKey()],
      errorToast: "Couldn't save the chat form settings",
    },
  });
}
