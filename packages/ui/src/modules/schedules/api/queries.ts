import { skipToken, useQuery } from "@tanstack/react-query";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { listAgentSessions } from "../../sessions/api/acp-session-ops.js";

export function prefetchSchedules(agentId: string) {
  return queryClient.prefetchQuery({
    ...trpc.schedules.list.queryOptions({ agentId }),
    staleTime: 5000,
  });
}

export function useSchedules(agentId: string | null) {
  return useQuery({
    ...trpc.schedules.list.queryOptions(agentId ? { agentId } : skipToken),
    refetchInterval: 5000,
    staleTime: 5000,
    meta: { errorToast: "Couldn't refresh schedules" },
  });
}

/** A schedule's sessions, read straight off the owning agent over ACP and
 *  filtered by `scheduleId` — the server has no session list. */
export function useScheduleSessions(
  agentId: string | null,
  scheduleId: string | null,
) {
  return useQuery({
    queryKey: ["schedule-sessions", agentId, scheduleId] as const,
    queryFn:
      agentId && scheduleId
        ? async () => {
            const sessions = await listAgentSessions(agentId);
            return sessions.filter((s) => s.scheduleId === scheduleId);
          }
        : skipToken,
    // Single-shot on expand; the list-level poll is authoritative for status.
    retry: 0,
    staleTime: 30_000,
    meta: { errorToast: "Couldn't load past runs for this schedule" },
  });
}
