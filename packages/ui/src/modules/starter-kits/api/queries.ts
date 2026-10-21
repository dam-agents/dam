import { useQuery } from "@tanstack/react-query";
import { LINKED_KIT_CATALOG } from "api-server-api";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";
import { kitLinkUrl } from "../lib/kit-link.js";

export function useStarterKits(enabled = true) {
  return useQuery({
    ...trpc.starterKits.list.queryOptions(),
    enabled,
  });
}

export function useStarterKit(catalog: string | null, id: string | null) {
  const linked = catalog === LINKED_KIT_CATALOG;
  const catalogKit = useQuery({
    ...trpc.starterKits.get.queryOptions({
      catalog: catalog ?? "",
      id: id ?? "",
    }),
    enabled: !linked && catalog !== null && id !== null,
    retry: (failures, error) =>
      error.data?.code !== "NOT_FOUND" && failures < 3,
  });
  const linkedKit = useQuery({
    ...trpc.starterKits.inspect.queryOptions({ url: kitLinkUrl(id ?? "") }),
    enabled: linked && id !== null,
    staleTime: Infinity,
    retry: (failures, error) =>
      error.data?.code === "BAD_GATEWAY" && failures < 2,
  });
  return linked ? linkedKit : catalogKit;
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
