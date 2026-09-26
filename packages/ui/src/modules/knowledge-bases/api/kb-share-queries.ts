import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useKbShareStatus(agentId: string | null) {
  return useQuery(
    trpc.kbShares.status.queryOptions(agentId ? { agentId } : skipToken),
  );
}

export function useKbShareDefaults(agentId: string | null, enabled: boolean) {
  return useQuery(
    trpc.kbShares.defaults.queryOptions(
      agentId && enabled ? { agentId } : skipToken,
    ),
  );
}
