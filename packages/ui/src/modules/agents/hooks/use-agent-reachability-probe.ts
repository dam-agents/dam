import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { useStore } from "../../../store.js";
import { createAgentTrpc } from "../agent-trpc.js";
import { useAgentRunState } from "../api/queries.js";

const PROBE_INTERVAL_MS = 3000;

/**
 * Half-open probe for the reachability circuit breaker. While an agent is
 * unreachable AND the server still reports it `running` (the window the
 * lifecycle poll can't see yet), this retries one cheap pod call every few
 * seconds. The createAgentTrpc fetch wrapper clears the breaker on the first
 * 2xx, which disables this query — so the overlay dismisses only on a real
 * success, never on a timer (no flicker). Real pod queries stay gated
 * meanwhile, so the pod sees one probe per interval, not the full poll storm.
 */
export function useAgentReachabilityProbe(agentId: string | null) {
  const runState = useAgentRunState(agentId);
  const unreachable = useStore((s) =>
    agentId ? s.unreachableAgents.has(agentId) : false,
  );
  const clearAgentUnreachable = useStore((s) => s.clearAgentUnreachable);

  // Once the server catches up to the outage (state leaves `running`), the
  // lifecycle gate owns the overlay; drop the breaker so the probe stops and
  // we don't render "Reconnecting" over a pod that's openly "Starting".
  useEffect(() => {
    if (agentId && unreachable && runState !== "running") {
      clearAgentUnreachable(agentId);
    }
  }, [agentId, unreachable, runState, clearAgentUnreachable]);

  const client = useMemo(
    () => (agentId ? createAgentTrpc(agentId) : null),
    [agentId],
  );

  useQuery({
    queryKey: ["agent-reachability-probe", agentId],
    queryFn: async () => {
      await client!.files.listDirs.query({ paths: [""] });
      return null;
    },
    enabled: !!client && unreachable && runState === "running",
    refetchInterval: PROBE_INTERVAL_MS,
    retry: false,
    gcTime: 0,
  });
}
