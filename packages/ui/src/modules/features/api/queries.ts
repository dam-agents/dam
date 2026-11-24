import { useMutation, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { forgetAssistantState } from "../../assistants/api/assistant-state.js";

export function useFeatures() {
  return useQuery({
    ...trpc.features.flags.queryOptions(),
    staleTime: 5 * 60_000,
    meta: { errorToast: "Couldn't load feature flags" },
  });
}

export function useInstallCapabilities() {
  return useQuery({
    ...trpc.features.install.queryOptions(),
    staleTime: Infinity,
    meta: { errorToast: "Couldn't load what this install supports" },
  });
}

export function useSetFeature() {
  return useMutation({
    ...trpc.features.setFlag.mutationOptions(),
    /* UNIT_BOUNDARY_DESCRIPTION: switching the assistant on makes it at that moment, so what this tab was told about it before the switch is dropped rather than answered from while the new record is being written. */
    onSuccess: (_flags, input) => {
      if (input.feature === "dambledore" && input.enabled)
        forgetAssistantState();
    },
    meta: {
      invalidates: [
        trpc.features.flags.queryKey(),
        trpc.connections.list.queryKey(),
        trpc.harnessConfig.status.pathKey(),
      ],
      errorToast: "Couldn't update the feature flag",
    },
  });
}
