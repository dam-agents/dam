import { useMutation, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/** Per-user feature flags (all default off; toggled in the hidden Features
 *  menu). Cached for the session — flag flips go through useSetFeature,
 *  which refreshes the cache immediately. */
export function useFeatures() {
  return useQuery({
    ...trpc.features.flags.queryOptions(),
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
