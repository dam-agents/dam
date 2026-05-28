import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";

export const acpSessionsKeys = {
  all: ["acp-sessions"] as const,
  agentLists: (agentId: string | null) =>
    [...acpSessionsKeys.all, agentId] as const,
  list: (agentId: string | null, includeChannel: boolean) =>
    [...acpSessionsKeys.agentLists(agentId), { includeChannel }] as const,
};

/**
 * Sessions list with live ACP enrichment (title, updatedAt) overlaid on the
 * platform DB rows. Pass `enabled: false` (e.g. while the agent is waking)
 * to keep the query in cache without firing requests.
 *
 * `refetchOnMount: "always"` because the title is harness-set after the first
 * turn — a returning user must see the updated title without a manual refresh.
 *
 * meta.errorToast is intentionally vague — sustained outages get the toast
 * once per outage via the global query cache wiring.
 *
 */
export function useAcpSessions(
  agentId: string | null,
  includeChannel: boolean,
  options?: { enabled?: boolean },
) {
  const live = !!agentId && (options?.enabled ?? true);
  return useQuery({
    queryKey: acpSessionsKeys.list(agentId, includeChannel),
    queryFn: live
      ? () => api.sessions.list.query({ agentId, includeChannel })
      : skipToken,
    refetchOnMount: "always",
    staleTime: 5_000,
    meta: { errorToast: "Couldn't refresh session list" },
  });
}
