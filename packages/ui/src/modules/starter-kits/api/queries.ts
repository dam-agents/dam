import { useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";
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

export function useKitUpdates() {
  return useQuery({
    ...trpc.starterKits.updates.queryOptions(),
    staleTime: 60_000,
  });
}

export function useKitUpdate(agentId: string | null) {
  const { data } = useKitUpdates();
  return agentId ? data?.find((u) => u.agentId === agentId) : undefined;
}

export function useKitUpdateChanges(
  agentId: string,
  target: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...trpc.starterKits.updateChanges.queryKey({ agentId }), target],
    queryFn: () => api.starterKits.updateChanges.query({ agentId }),
    enabled: enabled && target !== null,
    staleTime: Infinity,
  });
}
