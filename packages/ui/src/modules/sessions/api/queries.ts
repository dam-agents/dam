import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";

export const acpSessionsKeys = {
  all: ["acp-sessions"] as const,
  list: (instanceId: string | null, includeChannel: boolean) =>
    [...acpSessionsKeys.all, instanceId, { includeChannel }] as const,
};

/**
 * The session list lives on the agent pod, not the platform DB; it's only
 * meaningful when the instance is `running`. Pass `enabled: false` (e.g. while
 * waking) to keep the query in cache without firing requests.
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
    meta: { errorToast: "Couldn't refresh session list" },
  });
}
