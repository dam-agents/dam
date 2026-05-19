import { skipToken, useQuery } from "@tanstack/react-query";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

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

export function useScheduleSessions(scheduleId: string | null) {
  return useQuery({
    ...trpc.sessions.listByScheduleId.queryOptions(
      scheduleId ? { scheduleId } : skipToken,
    ),
    // Single-shot on expand; the list-level poll is authoritative for status.
    retry: 0,
    staleTime: 30_000,
    meta: { errorToast: "Couldn't load past runs for this schedule" },
  });
}
