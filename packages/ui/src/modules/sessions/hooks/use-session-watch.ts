import { useQueryClient } from "@tanstack/react-query";
import { podSessionNoticeSchema } from "agent-runtime-api";
import { useEffect } from "react";

import { watchWithRetry } from "../../../lib/watch-retry.js";
import { agentTrpc } from "../../agents/agent-trpc.js";
import {
  useAgentLacksLiveUpdates,
  useAgentRunState,
} from "../../agents/api/queries.js";
import { acpSessionsKeys } from "../api/queries.js";

export function useSessionWatch(agentId: string | null) {
  const queryClient = useQueryClient();
  const runState = useAgentRunState(agentId);
  const compat = useAgentLacksLiveUpdates(agentId);
  const enabled = !!agentId && !compat && runState === "running";

  useEffect(() => {
    if (!agentId || !enabled) return;
    return watchWithRetry((onError) =>
      agentTrpc(agentId).sessions.watch.subscribe(undefined, {
        onData: (notice) => {
          if (!podSessionNoticeSchema.safeParse(notice).success) return;
          void queryClient.invalidateQueries({
            queryKey: acpSessionsKeys.agentLists(agentId),
          });
        },
        onError,
      }),
    );
  }, [agentId, enabled, queryClient]);
}
