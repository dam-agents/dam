import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useStarterKits(enabled = true) {
  return useQuery({
    ...trpc.starterKits.list.queryOptions(),
    enabled,
    meta: { errorToast: "Couldn't load starter kits" },
  });
}

export function useStarterKit(catalog: string | null, id: string | null) {
  return useQuery({
    ...trpc.starterKits.get.queryOptions({
      catalog: catalog ?? "",
      id: id ?? "",
    }),
    enabled: catalog !== null && id !== null,
    meta: { errorToast: "Couldn't load the starter kit" },
  });
}

export function useStarterKitOnboarding(
  agentId: string | null,
  enabled: boolean,
) {
  return useQuery({
    ...trpc.starterKits.onboarding.queryOptions({ agentId: agentId ?? "" }),
    enabled: enabled && agentId !== null,
    staleTime: Infinity,
  });
}
