import { useMutation, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

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

export function useInstallCapabilities() {
  return useQuery({
    queryKey: ["features", "install"],
    queryFn: () =>
      Promise.resolve({
        virtualization: false,
        features: { "chat-forms": "experimental" as const },
      }),
    staleTime: Infinity,
    meta: { errorToast: "Couldn't load what this install supports" },
  });
}
