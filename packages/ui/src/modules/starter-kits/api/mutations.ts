import { useMutation } from "@tanstack/react-query";
import type { StarterKitApplyInput } from "api-server-api";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";
import { agentsKeys } from "../../agents/api/queries.js";

export function useApplyStarterKit() {
  return useMutation({
    mutationFn: (input: StarterKitApplyInput) =>
      api.starterKits.create.mutate(input),
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

export function useStartKitUpdate() {
  return useMutation({
    mutationFn: (agentId: string) =>
      api.starterKits.startUpdate.mutate({ agentId }),
    meta: {
      invalidates: [
        trpc.starterKits.updates.queryKey(),
        trpc.agents.list.queryKey(),
      ],
      errorToast: "Failed to start the kit update",
    },
  });
}

export function useSkipKitUpdate() {
  return useMutation({
    mutationFn: (agentId: string) =>
      api.starterKits.skipUpdate.mutate({ agentId }),
    meta: {
      invalidates: [trpc.starterKits.updates.queryKey()],
      errorToast: "Failed to skip the kit update",
    },
  });
}
