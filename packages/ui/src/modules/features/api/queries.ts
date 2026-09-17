import { useMutation, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useFeatures(enabled = true) {
  return useQuery({
    ...trpc.features.flags.queryOptions(),
    enabled,
    staleTime: 5 * 60_000,
    meta: { errorToast: "Couldn't load feature flags" },
  });
}

export function useSetFeature() {
  return useMutation({
    ...trpc.features.setFlag.mutationOptions(),
    meta: {
      invalidates: [trpc.features.flags.queryKey()],
      errorToast: "Couldn't update the feature flag",
    },
  });
}
