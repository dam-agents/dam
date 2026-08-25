import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { agentTrpc } from "../../agents/agent-trpc.js";
import { acpSessionsKeys } from "../api/queries.js";

export function useSessionWatch(agentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

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
