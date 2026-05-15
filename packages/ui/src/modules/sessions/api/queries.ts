import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";

export const acpSessionsKeys = {
  all: ["acp-sessions"] as const,
  instanceLists: (instanceId: string | null) =>
    [...acpSessionsKeys.all, instanceId] as const,
  list: (instanceId: string | null, includeChannel: boolean) =>
    [...acpSessionsKeys.instanceLists(instanceId), { includeChannel }] as const,
};

/**
 * Sessions list with live ACP enrichment (title, updatedAt) overlaid on the
 * platform DB rows. Pass `enabled: false` (e.g. while the instance is waking)
 * to keep the query in cache without firing requests.
 *
 * `refetchOnMount: "always"` because the title is harness-set after the first
 * turn — a returning user must see the updated title without a manual refresh.
 *
 * meta.errorToast is intentionally vague — sustained outages get the toast
 * once per outage via the global query cache wiring.
 */
export function useAcpSessions(
  instanceId: string | null,
  includeChannel: boolean,
  options?: { enabled?: boolean },
) {
  const live = !!instanceId && (options?.enabled ?? true);
  return useQuery({
    queryKey: acpSessionsKeys.list(instanceId, includeChannel),
    queryFn: live
      ? () => api.sessions.list.query({ instanceId, includeChannel })
      : skipToken,
    refetchOnMount: "always",
    staleTime: 5_000,
    meta: { errorToast: "Couldn't refresh session list" },
  });
}
