import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { useStore } from "../../../store.js";
import { createAgentTrpc } from "../agent-trpc.js";
import { useAgentRunState } from "../api/queries.js";

const PROBE_INTERVAL_MS = 3000;

export function useAgentReachabilityProbe(agentId: string | null) {
  const runState = useAgentRunState(agentId);
  const unreachable = useStore((s) =>
    agentId ? s.unreachableAgents.has(agentId) : false,
  );
  const clearAgentUnreachable = useStore((s) => s.clearAgentUnreachable);

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
