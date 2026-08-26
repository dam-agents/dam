import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { agentTrpc } from "../../agents/agent-trpc.js";
import { useAgentRunState } from "../../agents/api/queries.js";
import { acpSessionsKeys } from "../api/queries.js";

export function useSessionWatch(agentId: string | null) {
  const queryClient = useQueryClient();
  const runState = useAgentRunState(agentId);
  const enabled = !!agentId && runState === "running";

  useEffect(() => {
    if (!agentId || !enabled) return;
    const subscription = agentTrpc(agentId).sessions.watch.subscribe(
      undefined,
      {
        onData: () => {
          void queryClient.invalidateQueries({
            queryKey: acpSessionsKeys.agentLists(agentId),
          });
        },
      },
    );
    return () => subscription.unsubscribe();
  }, [agentId, enabled, queryClient]);
}
