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

export function fetchSchedulesForAgent(agentId: string) {
  return queryClient
    .fetchQuery(trpc.schedules.list.queryOptions({ agentId }))
    .catch(() => []);
}

export function useSchedules(agentId: string | null) {
  return useQuery({
    ...trpc.schedules.list.queryOptions(agentId ? { agentId } : skipToken),
    staleTime: 5000,
    meta: { errorToast: "Couldn't refresh schedules" },
  });
}

export function useOwnerSchedules(limit?: number) {
  return useQuery({
    ...trpc.schedules.listForOwner.queryOptions(
      limit === undefined ? undefined : { limit },
    ),
    staleTime: 5000,
    retry: false,
  });
}

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
    retry: 0,
    staleTime: 30_000,
  });
}
