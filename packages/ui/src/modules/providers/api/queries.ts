import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useProviderBalance(connectionId: string) {
  return useQuery({
    ...trpc.connections.getProviderBalance.queryOptions({ id: connectionId }),
    staleTime: 60_000,
    retry: false,
  });
}
