import { useMutation } from "@tanstack/react-query";
import type { StarterKitApplyInput } from "api-server-api";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";
import { agentsKeys } from "../../agents/api/queries.js";
import { withFlowSteps } from "../../usage/lib/ui-telemetry.js";

export function useApplyStarterKit() {
  return useMutation({
    mutationFn: withFlowSteps(
      "starter_kit_agent",
      (input: StarterKitApplyInput) => api.starterKits.create.mutate(input),
    ),
    meta: {
      invalidates: [
        agentsKeys.listWithChannels(),
        trpc.budgets.reserved.queryKey(),
        trpc.schedules.listForOwner.queryKey(),
      ],
      errorToast: "Couldn't create the agent from the starter kit",
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
        agentsKeys.listWithChannels(),
      ],
      errorToast: "Couldn't start the kit update",
    },
  });
}

export function useSkipKitUpdate() {
  return useMutation({
    mutationFn: (agentId: string) =>
      api.starterKits.skipUpdate.mutate({ agentId }),
    meta: {
      invalidates: [trpc.starterKits.updates.queryKey()],
      errorToast: "Couldn't skip the kit update",
    },
  });
}
