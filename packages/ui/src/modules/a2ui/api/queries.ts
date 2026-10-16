import { useMutation, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useChatFormPreferences(
  agentId: string | null,
  { quiet = false }: { quiet?: boolean } = {},
) {
  return useQuery({
    ...trpc.chatForms.preferences.queryOptions({ agentId: agentId ?? "" }),
    enabled: agentId !== null && agentId !== "",
    staleTime: 5 * 60_000,
    ...(quiet
      ? { retry: false }
      : { meta: { errorToast: "Couldn't load the chat form settings" } }),
  });
}

export function useSetChatFormPreferences() {
  return useMutation({
    ...trpc.chatForms.setPreferences.mutationOptions(),
    meta: {
      invalidates: [trpc.chatForms.preferences.queryKey()],
      errorToast: "Couldn't save the chat form settings",
    },
  });
}
