import { skipToken, useMutation, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/** An agent's saved harness defaults (model / mode), plus whether the harness
 *  can honor them. Options the user picks among come from ACP session config
 *  (the Zustand session-config slice), not from here. */
export function useAgentSettings(agentId: string | null) {
  return useQuery({
    ...trpc.agentSettings.get.queryOptions(agentId ? { agentId } : skipToken),
    retry: false,
  });
}

export function useSetAgentSettings() {
  return useMutation({
    ...trpc.agentSettings.set.mutationOptions(),
    meta: {
      invalidates: [trpc.agentSettings.get.queryKey()],
      errorToast: "Failed to save model settings",
    },
  });
}
