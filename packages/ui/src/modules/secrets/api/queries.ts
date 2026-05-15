import { useQuery } from "@tanstack/react-query";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

export function prefetchSecrets() {
  return queryClient.prefetchQuery(trpc.secrets.list.queryOptions());
}

export function useSecrets(options?: { enabled?: boolean }) {
  return useQuery({
    ...trpc.secrets.list.queryOptions(),
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load secrets" },
  });
}

/**
 * Agents that have this secret in their granted set. Driven on-demand when
 * the secret-edit dialog is about to roll those agents (ADR-040).
 */
export function useGrantedAgentsForSecret(
  id: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    ...trpc.secrets.listGrantedAgents.queryOptions({ id }),
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't list granted agents" },
  });
}
