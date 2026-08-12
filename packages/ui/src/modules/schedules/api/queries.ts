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

/** One-shot imperative fetch for flows that need the schedules *now* (e.g.
 *  the stop-confirm dialog warning that a schedule will restart the sandbox).
 *  Failures resolve to an empty list — the caller's flow must not block on a
 *  schedules hiccup. */
export function fetchSchedulesForAgent(agentId: string) {
  return queryClient
    .fetchQuery(trpc.schedules.list.queryOptions({ agentId }))
    .catch(() => []);
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
    // No errorToast: a never-run schedule (or an asleep agent that can't be
    // listed) is an expected state — the results modal surfaces it inline.
  });
}
