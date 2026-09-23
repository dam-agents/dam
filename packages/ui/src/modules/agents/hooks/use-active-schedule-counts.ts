import { useMemo } from "react";

import { useOwnerSchedules } from "../../schedules/api/queries.js";
import { isUpcoming } from "../../schedules/lib/once-schedule.js";

export function useActiveScheduleCounts(): ReadonlyMap<string, number> {
  const { data } = useOwnerSchedules();
  return useMemo(() => {
    const byAgent = new Map<string, number>();
    for (const schedule of data ?? []) {
      if (!isUpcoming(schedule)) continue;
      byAgent.set(schedule.agentId, (byAgent.get(schedule.agentId) ?? 0) + 1);
    }
    return byAgent;
  }, [data]);
}
