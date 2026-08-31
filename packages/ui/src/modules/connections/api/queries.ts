import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useAppConnections(options?: {
  enabled?: boolean;
  fresh?: boolean;
}) {
  return useQuery({
    ...trpc.connections.list.queryOptions(),
    enabled: options?.enabled ?? true,
    ...(options?.fresh
      ? { staleTime: 0, refetchOnMount: "always" as const }
      : {}),
    meta: { errorToast: "Couldn't load connections" },
  });
}

export function useConnectionTemplates(options?: { enabled?: boolean }) {
  return useQuery({
    ...trpc.connections.listTemplates.queryOptions(),
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load connection templates" },
  });
}
