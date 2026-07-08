import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/** Telemetry overview for one agent. Disabled while no agent is selected. */
export function useTelemetryOverview(
  agentId: string | null,
  opts?: { sinceHours?: number; sessionId?: string; limit?: number },
) {
  return useQuery({
    ...trpc.telemetry.overview.queryOptions(
      agentId ? { agentId, ...opts } : skipToken,
    ),
    refetchInterval: 15000,
    staleTime: 15000,
    retry: false,
  });
}
