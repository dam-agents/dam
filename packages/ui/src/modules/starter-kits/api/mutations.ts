import { useMutation } from "@tanstack/react-query";
import type { StarterKitApplyInput } from "api-server-api";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";
import { agentsKeys } from "../../agents/api/queries.js";

export function useApplyStarterKit() {
  return useMutation({
    mutationFn: (input: StarterKitApplyInput) =>
      api.starterKits.apply.mutate(input),
    meta: {
      invalidates: [
        agentsKeys.listWithChannels(),
        trpc.agents.list.queryKey(),
        trpc.budgets.reserved.queryKey(),
        trpc.schedules.listForOwner.queryKey(),
      ],
      errorToast: "Failed to create the agent from the starter kit",
    },
  });
}
